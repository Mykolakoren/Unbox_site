import { useState } from 'react';
import type { TaskStatus, TaskPriority } from '../../store/adminTaskStore';
import { useAdminTaskStore } from '../../store/adminTaskStore';
import { GripVertical, User, Clock, Trash2 } from 'lucide-react';
import { format, isPast, isToday, isTomorrow } from 'date-fns';
import { ru } from 'date-fns/locale';
import clsx from 'clsx';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';

const COLUMNS: { id: TaskStatus; title: string; color: string; headerColor: string }[] = [
    { id: 'TODO', title: 'К выполнению', color: 'bg-slate-50 border-slate-200/60', headerColor: 'text-slate-700 bg-slate-200/50' },
    { id: 'IN_PROGRESS', title: 'В процессе', color: 'bg-unbox-light/50 border-blue-100', headerColor: 'text-unbox-dark bg-unbox-light/50' },
    { id: 'DONE', title: 'Готово', color: 'bg-emerald-50/50 border-emerald-100', headerColor: 'text-emerald-700 bg-emerald-100/50' },
];

export function AdminTasksBoard() {
    const { tasks, addTask, moveTask, deleteTask } = useAdminTaskStore();
    const [draggedId, setDraggedId] = useState<string | null>(null);

    // --- New Task Form State ---
    const [isAdding, setIsAdding] = useState(false);
    const [newTaskTitle, setNewTaskTitle] = useState('');
    const [newTaskAssignee, setNewTaskAssignee] = useState('');
    const [newTaskDate, setNewTaskDate] = useState('');
    const [newTaskPriority, setNewTaskPriority] = useState<TaskPriority>('MEDIUM');

    // --- Drag and Drop Handlers ---
    const handleDragStart = (e: React.DragEvent, id: string) => {
        setDraggedId(id);
        e.dataTransfer.effectAllowed = 'move';
        // Minor visual feedback
        e.dataTransfer.setData('text/plain', id);
        setTimeout(() => {
            if (e.target instanceof HTMLElement) {
                e.target.style.opacity = '0.5';
            }
        }, 0);
    };

    const handleDragEnd = (e: React.DragEvent) => {
        setDraggedId(null);
        if (e.target instanceof HTMLElement) {
            e.target.style.opacity = '1';
        }
    };

    const handleDragOver = (e: React.DragEvent) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
    };

    const handleDrop = (e: React.DragEvent, status: TaskStatus) => {
        e.preventDefault();
        const id = e.dataTransfer.getData('text/plain');
        if (id && draggedId === id) {
            moveTask(id, status);
        }
    };

    // --- Actions ---
    const handleCreateTask = (e: React.FormEvent) => {
        e.preventDefault();
        if (!newTaskTitle.trim()) return;

        addTask({
            title: newTaskTitle,
            status: 'TODO',
            priority: newTaskPriority,
            assignee: newTaskAssignee || undefined,
            deadline: newTaskDate ? new Date(newTaskDate).toISOString() : undefined,
        });

        setIsAdding(false);
        setNewTaskTitle('');
        setNewTaskAssignee('');
        setNewTaskDate('');
        setNewTaskPriority('MEDIUM');
    };

    // --- Render Helpers ---
    const getPriorityColor = (priority: TaskPriority) => {
        switch (priority) {
            case 'HIGH': return 'text-red-600 bg-red-100';
            case 'MEDIUM': return 'text-yellow-600 bg-yellow-100';
            case 'LOW': return 'text-green-600 bg-green-100';
            default: return 'text-unbox-grey bg-unbox-light/50';
        }
    };

    const formatDeadline = (isoStr?: string) => {
        if (!isoStr) return null;
        const d = new Date(isoStr);
        let color = 'text-unbox-grey';

        if (isPast(d) && !isToday(d)) color = 'text-red-500 font-bold';
        else if (isToday(d)) color = 'text-orange-500 font-bold';
        else if (isTomorrow(d)) color = 'text-yellow-600';

        return (
            <div className={clsx("flex items-center gap-1.5 text-[11px] font-medium mt-3", color)}>
                <Clock size={12} strokeWidth={2.5} />
                <span>{format(d, 'd MMM, HH:mm', { locale: ru })}</span>
            </div>
        );
    };

    return (
        <div className="h-full flex flex-col max-w-7xl">
            <div className="flex items-center justify-between mb-6">
                <div>
                    <h1 className="text-2xl font-bold text-unbox-dark">Задачи администраторов</h1>
                    <p className="text-sm text-unbox-grey mt-1">
                        Организация работы, закрепление ответственных и дедлайны
                    </p>
                </div>
                <Button onClick={() => setIsAdding(!isAdding)} variant={isAdding ? 'outline' : 'primary'}>
                    {isAdding ? 'Отмена' : 'Добавить задачу'}
                </Button>
            </div>

            {/* Quick Add Form */}
            {isAdding && (
                <Card className="mb-6 animate-in slide-in-from-top-4">
                    <form onSubmit={handleCreateTask} className="grid grid-cols-1 md:grid-cols-5 gap-4 items-end">
                        <div className="md:col-span-2">
                            <label className="block text-xs font-semibold text-unbox-grey mb-1">Задача *</label>
                            <input
                                required
                                value={newTaskTitle}
                                onChange={e => setNewTaskTitle(e.target.value)}
                                placeholder="Что нужно сделать?"
                                className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-unbox-green outline-none"
                            />
                        </div>
                        <div>
                            <label className="block text-xs font-semibold text-unbox-grey mb-1">Ответственный</label>
                            <input
                                value={newTaskAssignee}
                                onChange={e => setNewTaskAssignee(e.target.value)}
                                placeholder="Имя"
                                className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-unbox-green outline-none"
                            />
                        </div>
                        <div>
                            <label className="block text-xs font-semibold text-unbox-grey mb-1">Дедлайн</label>
                            <input
                                type="datetime-local"
                                value={newTaskDate}
                                onChange={e => setNewTaskDate(e.target.value)}
                                className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-unbox-green outline-none"
                            />
                        </div>
                        <div className="flex gap-2">
                            <div className="flex-1">
                                <label className="block text-xs font-semibold text-unbox-grey mb-1">Приоритет</label>
                                <select
                                    value={newTaskPriority}
                                    onChange={(e) => setNewTaskPriority(e.target.value as TaskPriority)}
                                    className="w-full px-3 py-2 border rounded-lg outline-none"
                                >
                                    <option value="LOW">Низкий</option>
                                    <option value="MEDIUM">Средний</option>
                                    <option value="HIGH">Высокий</option>
                                </select>
                            </div>
                            <Button type="submit" className="mb-[1px]">Создать</Button>
                        </div>
                    </form>
                </Card>
            )}

            {/* Kanban Columns */}
            <div className="flex-1 overflow-x-auto">
                <div className="flex gap-6 min-w-max pb-4 h-full items-start">
                    {COLUMNS.map(col => {
                        const colTasks = tasks.filter(t => t.status === col.id);
                        return (
                            <div
                                key={col.id}
                                className={clsx("w-[320px] rounded-2xl border p-3 flex flex-col gap-3 min-h-[600px] shadow-sm transition-colors", col.color)}
                                onDragOver={handleDragOver}
                                onDrop={(e) => handleDrop(e, col.id)}
                            >
                                <div className="flex items-center justify-between mb-1 px-1">
                                    <div className="flex items-center gap-2">
                                        <h3 className="font-bold text-sm text-unbox-dark">{col.title}</h3>
                                        <span className={clsx("text-xs font-bold px-2 py-0.5 rounded-full", col.headerColor)}>
                                            {colTasks.length}
                                        </span>
                                    </div>
                                </div>

                                <div className="flex flex-col gap-3 flex-1">
                                    {colTasks.map(task => (
                                        <div
                                            key={task.id}
                                            draggable
                                            onDragStart={(e) => handleDragStart(e, task.id)}
                                            onDragEnd={handleDragEnd}
                                            className="bg-white p-3.5 rounded-xl shadow-[0_1px_3px_rgba(0,0,0,0.05)] border border-unbox-light/80 cursor-grab active:cursor-grabbing hover:shadow-[0_4px_12px_rgba(0,0,0,0.05)] hover:border-unbox-light transition-all duration-200 group relative"
                                        >
                                            <div className="flex items-start gap-2.5">
                                                <div className="mt-0.5 text-gray-300 group-hover:text-unbox-grey transition-colors">
                                                    <GripVertical size={16} />
                                                </div>
                                                <div className="flex-1 min-w-0">
                                                    <div className="flex items-start justify-between mb-2">
                                                        <span className={clsx("text-[10px] uppercase tracking-wide font-bold px-2 py-0.5 rounded", getPriorityColor(task.priority))}>
                                                            {task.priority === 'HIGH' ? 'СРОЧНО' : task.priority === 'MEDIUM' ? 'СРЕДНИЙ' : 'НИЗКИЙ'}
                                                        </span>
                                                        <button
                                                            onClick={() => deleteTask(task.id)}
                                                            className="text-gray-300 hover:text-red-500 hover:bg-red-50 p-1 rounded-md opacity-0 group-hover:opacity-100 transition-all"
                                                        >
                                                            <Trash2 size={14} />
                                                        </button>
                                                    </div>
                                                    <p className="text-[13px] font-semibold text-unbox-dark leading-snug">{task.title}</p>

                                                    {task.description && (
                                                        <p className="text-xs text-unbox-grey mt-1.5 leading-relaxed line-clamp-2">{task.description}</p>
                                                    )}

                                                    <div className="flex items-center justify-between mt-3 pt-3 border-t border-gray-50">
                                                        {task.assignee ? (
                                                            <div className="flex items-center gap-1.5 text-[11px] font-medium text-unbox-grey bg-unbox-light/30 border border-unbox-light px-2 py-1 rounded-md">
                                                                <User size={12} strokeWidth={2.5} />
                                                                <span className="truncate max-w-[100px]">{task.assignee}</span>
                                                            </div>
                                                        ) : <div />}

                                                        {formatDeadline(task.deadline)}
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    ))}

                                    {colTasks.length === 0 && (
                                        <div className="flex-1 flex flex-col items-center justify-center border-2 border-dashed border-unbox-light/60 rounded-xl bg-unbox-light/30/30 text-unbox-grey text-sm italic py-8">
                                            <span>Перетащите сюда</span>
                                        </div>
                                    )}
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>
    );
}
