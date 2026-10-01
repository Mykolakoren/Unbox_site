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
    /** Ошибку сервера пробрасывает — экран сам говорит «не получилось»
     *  и не пишет «Создано» (G8-admin-ops-M1). */
    addTask: (data: CreateTaskPayload) => Promise<AdminTask>;
    /** Пробрасывает ошибку: окно не закрывается, «Сохранено» не показываем. */
    updateTask: (id: string, updates: UpdateTaskPayload) => Promise<void>;
    /** true — задача удалена на сервере; false — не вышло (тост «Удалено» не показывать). */
    deleteTask: (id: string) => Promise<boolean>;
    /** Сразу двигает карточку; при ошибке возвращает её назад и пробрасывает ошибку. */
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
        const task = await adminTasksApi.create(data);
        set((state) => ({ tasks: [...state.tasks, task] }));
        return task;
    },

    updateTask: async (id, updates) => {
        const updated = await adminTasksApi.update(id, updates);
        set((state) => ({
            tasks: state.tasks.map((t) => (t.id === id ? updated : t)),
        }));
    },

    deleteTask: async (id) => {
        try {
            await adminTasksApi.delete(id);
            set((state) => ({ tasks: state.tasks.filter((t) => t.id !== id) }));
            return true;
        } catch (e: any) {
            console.error('Failed to delete task:', e);
            return false;
        }
    },

    moveTask: async (id, newStatus) => {
        const before = get().tasks.find((t) => t.id === id)?.status;
        // Optimistic update
        set((state) => ({
            tasks: state.tasks.map((t) => (t.id === id ? { ...t, status: newStatus } : t)),
        }));
        try {
            await adminTasksApi.update(id, { status: newStatus });
        } catch (e) {
            // Возвращаем карточку на место и говорим экрану, что не вышло.
            if (before) {
                set((state) => ({
                    tasks: state.tasks.map((t) => (t.id === id ? { ...t, status: before } : t)),
                }));
            }
            throw e;
        }
    },

    reorderTasks: async (items) => {
        await adminTasksApi.reorder(items);
        await get().fetchTasks();
    },
}));
