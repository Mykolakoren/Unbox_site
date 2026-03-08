import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type TaskStatus = 'TODO' | 'IN_PROGRESS' | 'DONE';
export type TaskPriority = 'LOW' | 'MEDIUM' | 'HIGH';

export interface AdminTask {
    id: string;
    title: string;
    description?: string;
    status: TaskStatus;
    assignee?: string;
    deadline?: string; // ISO date string
    priority: TaskPriority;
    createdAt: string;
}

interface AdminTaskState {
    tasks: AdminTask[];
    addTask: (task: Omit<AdminTask, 'id' | 'createdAt'>) => void;
    updateTask: (id: string, updates: Partial<AdminTask>) => void;
    deleteTask: (id: string) => void;
    moveTask: (id: string, newStatus: TaskStatus) => void;
}

// Initial mock data to show the user how it looks
const initialTasks: AdminTask[] = [
    {
        id: '1',
        title: 'Подготовить отчет за февраль',
        description: 'Свести данные по продажам абонементов и загрузке кабинетов.',
        status: 'TODO',
        assignee: 'Mykola',
        deadline: new Date(Date.now() + 86400000 * 2).toISOString(), // +2 days
        priority: 'HIGH',
        createdAt: new Date().toISOString()
    },
    {
        id: '2',
        title: 'Полить цветы в холле',
        status: 'IN_PROGRESS',
        assignee: 'Администратор смены',
        priority: 'LOW',
        createdAt: new Date().toISOString()
    },
    {
        id: '3',
        title: 'Обновить бумажные полотенца',
        status: 'DONE',
        priority: 'MEDIUM',
        createdAt: new Date().toISOString()
    }
];

export const useAdminTaskStore = create<AdminTaskState>()(
    persist(
        (set) => ({
            tasks: initialTasks,

            addTask: (taskData) => set((state) => ({
                tasks: [
                    ...state.tasks,
                    {
                        ...taskData,
                        id: Math.random().toString(36).substring(2, 9),
                        createdAt: new Date().toISOString()
                    }
                ]
            })),

            updateTask: (id, updates) => set((state) => ({
                tasks: state.tasks.map(t => t.id === id ? { ...t, ...updates } : t)
            })),

            deleteTask: (id) => set((state) => ({
                tasks: state.tasks.filter(t => t.id !== id)
            })),

            moveTask: (id, newStatus) => set((state) => ({
                tasks: state.tasks.map(t => t.id === id ? { ...t, status: newStatus } : t)
            }))
        }),
        {
            name: 'unbox-admin-tasks',
        }
    )
);
