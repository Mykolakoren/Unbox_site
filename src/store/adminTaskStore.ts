import { create } from 'zustand';
import { adminTasksApi, type AdminTask, type AdminTaskComment, type CreateTaskPayload, type UpdateTaskPayload } from '../api/adminTasks';

export type TaskStatus = 'TODO' | 'IN_PROGRESS' | 'DONE';
export type TaskPriority = 'LOW' | 'MEDIUM' | 'HIGH';

// Re-export for backward compat
export type { AdminTask, AdminTaskComment };

interface AdminTaskState {
    tasks: AdminTask[];
    loading: boolean;
    error: string | null;

    fetchTasks: () => Promise<void>;
    addTask: (data: CreateTaskPayload) => Promise<AdminTask | null>;
    updateTask: (id: string, updates: UpdateTaskPayload) => Promise<void>;
    deleteTask: (id: string) => Promise<void>;
    moveTask: (id: string, newStatus: TaskStatus) => Promise<void>;
    reorderTasks: (items: { id: string; sortOrder: number; status?: string }[]) => Promise<void>;
}

export const useAdminTaskStore = create<AdminTaskState>()((set, get) => ({
    tasks: [],
    loading: false,
    error: null,

    fetchTasks: async () => {
        set({ loading: true, error: null });
        try {
            const tasks = await adminTasksApi.list();
            set({ tasks, loading: false });
        } catch (e: any) {
            set({ error: e.message, loading: false });
        }
    },

    addTask: async (data) => {
        try {
            const task = await adminTasksApi.create(data);
            set((state) => ({ tasks: [...state.tasks, task] }));
            return task;
        } catch (e: any) {
            console.error('Failed to create task:', e?.response?.data || e?.message || e);
            const { toast } = await import('sonner');
            toast.error(`Ошибка создания: ${e?.response?.data?.detail || e?.message || 'Неизвестная ошибка'}`);
            return null;
        }
    },

    updateTask: async (id, updates) => {
        try {
            const updated = await adminTasksApi.update(id, updates);
            set((state) => ({
                tasks: state.tasks.map((t) => (t.id === id ? updated : t)),
            }));
        } catch (e: any) {
            console.error('Failed to update task:', e);
        }
    },

    deleteTask: async (id) => {
        try {
            await adminTasksApi.delete(id);
            set((state) => ({ tasks: state.tasks.filter((t) => t.id !== id) }));
        } catch (e: any) {
            console.error('Failed to delete task:', e);
        }
    },

    moveTask: async (id, newStatus) => {
        // Optimistic update
        set((state) => ({
            tasks: state.tasks.map((t) => (t.id === id ? { ...t, status: newStatus } : t)),
        }));
        try {
            await adminTasksApi.update(id, { status: newStatus });
        } catch (e: any) {
            console.error('Failed to move task:', e);
            get().fetchTasks();
        }
    },

    reorderTasks: async (items) => {
        try {
            await adminTasksApi.reorder(items);
            get().fetchTasks();
        } catch (e: any) {
            console.error('Failed to reorder:', e);
        }
    },
}));
