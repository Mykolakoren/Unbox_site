import { useState } from 'react';
import { CheckSquare, Plus, Trash2, Calendar } from 'lucide-react';
import { useUserStore, type Task } from '../../store/userStore';
import { format } from 'date-fns';
import { ru } from 'date-fns/locale';
import clsx from 'clsx';
import { Button } from '../ui/Button';

interface UserTasksProps {
    email: string;
    tasks: Task[];
}

export function UserTasks({ email, tasks }: UserTasksProps) {
    const { addUserTask, toggleUserTask, removeUserTask } = useUserStore();
    const [newTaskText, setNewTaskText] = useState('');
    const [dueDate, setDueDate] = useState('');

    const handleAddTask = (e?: React.FormEvent) => {
        e?.preventDefault();
        if (!newTaskText.trim()) return;

        addUserTask(email, {
            text: newTaskText.trim(),
            isCompleted: false,
            dueDate: dueDate || undefined
        });
        setNewTaskText('');
        setDueDate('');
    };

    const sortedTasks = [...tasks].sort((a, b) => {
        if (a.isCompleted === b.isCompleted) {
            // If both incomplete, sort by due date (soonest first)
            if (!a.isCompleted) {
                if (a.dueDate && b.dueDate) return new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime();
                if (a.dueDate) return -1;
                if (b.dueDate) return 1;
            }
            return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
        }
        return a.isCompleted ? 1 : -1;
    });

    return (
        <div className="bg-white p-6 rounded-2xl border border-gray-200 h-full flex flex-col">
            <h3 className="font-bold text-lg mb-4 flex items-center gap-2">
                <CheckSquare size={20} className="text-gray-400" />
                Задачи и напоминания
            </h3>

            <form onSubmit={handleAddTask} className="flex gap-2 mb-4 items-center">
                <div className="flex-1 space-y-2">
                    <input
                        type="text"
                        className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-black"
                        placeholder="Новая задача..."
                        value={newTaskText}
                        onChange={(e) => setNewTaskText(e.target.value)}
                    />
                    <input
                        type="date"
                        className="w-full px-3 py-1.5 border border-gray-200 rounded-lg text-xs text-gray-500 focus:outline-none focus:ring-2 focus:ring-black"
                        value={dueDate}
                        onChange={(e) => setDueDate(e.target.value)}
                    />
                </div>
                <Button size="sm" type="submit" disabled={!newTaskText.trim()} className="h-full py-4">
                    <Plus size={16} />
                </Button>
            </form>

            <div className="flex-1 overflow-y-auto space-y-2 min-h-[100px]">
                {sortedTasks.length === 0 && (
                    <div className="text-center text-gray-400 text-sm py-4 italic">
                        Нет активных задач
                    </div>
                )}

                {sortedTasks.map(task => {
                    const isOverdue = !task.isCompleted && task.dueDate && new Date(task.dueDate) < new Date(new Date().setHours(0, 0, 0, 0));
                    const isDueToday = !task.isCompleted && task.dueDate && new Date(task.dueDate).toDateString() === new Date().toDateString();

                    return (
                        <div
                            key={task.id}
                            className={clsx(
                                "group flex items-start gap-3 p-3 rounded-xl border transition-all",
                                task.isCompleted ? "bg-gray-50 border-gray-100" : "bg-white border-gray-200 hover:border-gray-300",
                                isOverdue && "border-red-200 bg-red-50/30"
                            )}
                        >
                            <input
                                type="checkbox"
                                checked={task.isCompleted}
                                onChange={() => toggleUserTask(email, task.id)}
                                className="mt-1 w-4 h-4 rounded border-gray-300 text-black focus:ring-black cursor-pointer"
                            />

                            <div className="flex-1 min-w-0">
                                <div className={clsx("text-sm break-words", task.isCompleted && "text-gray-400 line-through")}>
                                    {task.text}
                                </div>
                                <div className="flex items-center gap-3 mt-1">
                                    <div className="text-[10px] text-gray-400 flex items-center gap-1">
                                        <Calendar size={10} />
                                        {format(new Date(task.createdAt), 'd MMM', { locale: ru })}
                                    </div>
                                    {task.dueDate && (
                                        <div className={clsx(
                                            "text-[10px] flex items-center gap-1 font-medium",
                                            isOverdue ? "text-red-500" : isDueToday ? "text-amber-500" : "text-blue-500"
                                        )}>
                                            <Calendar size={10} />
                                            До: {format(new Date(task.dueDate), 'd MMM', { locale: ru })}
                                        </div>
                                    )}
                                </div>
                            </div>

                            <button
                                onClick={() => removeUserTask(email, task.id)}
                                className="text-gray-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"
                            >
                                <Trash2 size={14} />
                            </button>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
