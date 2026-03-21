import { useState, useEffect, useMemo } from 'react';
import { useAdminTaskStore, type TaskStatus, type TaskPriority } from '../../store/adminTaskStore';
import type { AdminTask } from '../../api/adminTasks';
import { adminTasksApi, type AdminTaskComment, type ChecklistItem } from '../../api/adminTasks';
import { useUserStore } from '../../store/userStore';
import {
    GripVertical, User, Clock, Trash2, Plus, Search,
    X, MessageSquare, CheckSquare, Square, Tag, Send, Loader2,
    Archive,
} from 'lucide-react';
import { format, isPast, isToday, isTomorrow, differenceInDays } from 'date-fns';
import { ru } from 'date-fns/locale';
import clsx from 'clsx';
import { Button } from '../../components/ui/Button';
import { toast } from 'sonner';
import {
    DndContext, closestCorners, PointerSensor, TouchSensor,
    KeyboardSensor, useSensor, useSensors, type DragEndEvent, DragOverlay,
} from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

// ── Constants ────────────────────────────────────────────────────────────────

const COLUMNS: { id: TaskStatus; title: string; color: string; headerColor: string; headerBg: string }[] = [
    { id: 'TODO', title: 'К выполнению', color: 'border-slate-200/60', headerColor: 'text-slate-700', headerBg: 'bg-slate-100' },
    { id: 'IN_PROGRESS', title: 'В процессе', color: 'border-blue-200/60', headerColor: 'text-blue-700', headerBg: 'bg-blue-50' },
    { id: 'DONE', title: 'Готово', color: 'border-emerald-200/60', headerColor: 'text-emerald-700', headerBg: 'bg-emerald-50' },
];

const LABEL_OPTIONS = [
    { value: 'cleaning', label: 'Уборка', color: 'bg-cyan-100 text-cyan-700 border-cyan-200' },
    { value: 'finance', label: 'Финансы', color: 'bg-green-100 text-green-700 border-green-200' },
    { value: 'clients', label: 'Клиенты', color: 'bg-violet-100 text-violet-700 border-violet-200' },
    { value: 'rooms', label: 'Кабинеты', color: 'bg-orange-100 text-orange-700 border-orange-200' },
    { value: 'purchase', label: 'Закупки', color: 'bg-pink-100 text-pink-700 border-pink-200' },
    { value: 'marketing', label: 'Маркетинг', color: 'bg-yellow-100 text-yellow-700 border-yellow-200' },
    { value: 'tech', label: 'Техника', color: 'bg-gray-100 text-gray-700 border-gray-200' },
];

const PRIORITY_LABELS: Record<string, { label: string; color: string }> = {
    HIGH: { label: 'Срочно', color: 'text-red-600 bg-red-50 border-red-200' },
    MEDIUM: { label: 'Средний', color: 'text-amber-600 bg-amber-50 border-amber-200' },
    LOW: { label: 'Низкий', color: 'text-green-600 bg-green-50 border-green-200' },
};

// ── Main Component ───────────────────────────────────────────────────────────

export function AdminTasksBoard() {
    const { tasks, loading, fetchTasks, addTask, updateTask, deleteTask, moveTask } = useAdminTaskStore();
    const { users } = useUserStore();
    const admins = useMemo(() => users.filter(u => ['admin', 'senior_admin', 'owner'].includes(u.role || '')), [users]);

    const [editingTask, setEditingTask] = useState<AdminTask | null>(null);
    const [quickAddCol, setQuickAddCol] = useState<TaskStatus | null>(null);
    const [quickAddTitle, setQuickAddTitle] = useState('');
    const [searchQuery, setSearchQuery] = useState('');
    const [filterPriority, setFilterPriority] = useState<string>('');
    const [filterAssignee, setFilterAssignee] = useState<string>('');
    const [showArchive, setShowArchive] = useState(false);
    const [activeId, setActiveId] = useState<string | null>(null);

    useEffect(() => { fetchTasks(); }, [fetchTasks]);

    const sensors = useSensors(
        useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
        useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } }),
        useSensor(KeyboardSensor),
    );

    const filteredTasks = useMemo(() => {
        let result = tasks;
        if (searchQuery) {
            const q = searchQuery.toLowerCase();
            result = result.filter(t => t.title.toLowerCase().includes(q) || (t.description || '').toLowerCase().includes(q));
        }
        if (filterPriority) result = result.filter(t => t.priority === filterPriority);
        if (filterAssignee) result = result.filter(t => t.assigneeId === filterAssignee);
        return result;
    }, [tasks, searchQuery, filterPriority, filterAssignee]);

    const getColumnTasks = (status: TaskStatus) => {
        let colTasks = filteredTasks.filter(t => t.status === status);
        if (status === 'DONE' && !showArchive) {
            colTasks = colTasks.filter(t => differenceInDays(new Date(), new Date(t.updatedAt)) <= 7);
        }
        return colTasks.sort((a, b) => a.sortOrder - b.sortOrder);
    };

    const archivedCount = useMemo(() =>
        filteredTasks.filter(t => t.status === 'DONE' && differenceInDays(new Date(), new Date(t.updatedAt)) > 7).length
    , [filteredTasks]);

    const handleDragStart = (event: any) => setActiveId(event.active.id as string);
    const handleDragEnd = (event: DragEndEvent) => {
        setActiveId(null);
        const { active, over } = event;
        if (!over) return;
        const taskId = active.id as string;
        const overId = over.id as string;
        const targetCol = COLUMNS.find(c => c.id === overId);
        if (targetCol) { moveTask(taskId, targetCol.id); return; }
        const overTask = tasks.find(t => t.id === overId);
        if (overTask) moveTask(taskId, overTask.status as TaskStatus);
    };

    const handleQuickAdd = async (status: TaskStatus) => {
        if (!quickAddTitle.trim()) return;
        await addTask({ title: quickAddTitle.trim(), status });
        setQuickAddTitle('');
        setQuickAddCol(null);
        toast.success('Задача создана');
    };

    const activeTask = activeId ? tasks.find(t => t.id === activeId) : null;
    const hasFilters = !!searchQuery || !!filterPriority || !!filterAssignee;
    const emptyNewTask: AdminTask = { id: '', title: '', description: '', status: 'TODO', priority: 'MEDIUM', labels: [], checklist: [], sortOrder: 0, createdBy: '', createdByName: '', createdAt: '', updatedAt: '' } as AdminTask;

    return (
        <div className="h-full flex flex-col">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
                <div>
                    <h1 className="text-2xl font-bold text-unbox-dark">Задачи</h1>
                    <p className="text-sm text-unbox-grey mt-0.5">{tasks.length} задач · {tasks.filter(t => t.status === 'DONE').length} завершено</p>
                </div>
                <Button onClick={() => setEditingTask(emptyNewTask)}>
                    <Plus size={16} className="mr-1.5" /> Новая задача
                </Button>
            </div>

            <div className="flex flex-wrap gap-2 mb-4">
                <div className="relative flex-1 min-w-[200px] max-w-sm">
                    <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-unbox-grey" />
                    <input value={searchQuery} onChange={e => setSearchQuery(e.target.value)} placeholder="Поиск задач..."
                        className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 rounded-lg focus:ring-2 focus:ring-unbox-green outline-none" />
                </div>
                <select value={filterPriority} onChange={e => setFilterPriority(e.target.value)}
                    className="px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none">
                    <option value="">Все приоритеты</option>
                    <option value="HIGH">🔴 Срочно</option>
                    <option value="MEDIUM">🟡 Средний</option>
                    <option value="LOW">🟢 Низкий</option>
                </select>
                <select value={filterAssignee} onChange={e => setFilterAssignee(e.target.value)}
                    className="px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none">
                    <option value="">Все ответственные</option>
                    {admins.map(a => <option key={a.email} value={String((a as any).id || a.email)}>{a.name}</option>)}
                </select>
                {hasFilters && (
                    <button onClick={() => { setSearchQuery(''); setFilterPriority(''); setFilterAssignee(''); }}
                        className="px-3 py-2 text-sm text-red-500 hover:bg-red-50 rounded-lg flex items-center gap-1">
                        <X size={14} /> Сбросить
                    </button>
                )}
            </div>

            {loading ? (
                <div className="flex-1 flex items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-unbox-green" /></div>
            ) : (
                <DndContext sensors={sensors} collisionDetection={closestCorners} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
                    <div className="flex-1 overflow-x-auto pb-4">
                        <div className="flex gap-4 min-w-max h-full items-stretch">
                            {COLUMNS.map(col => {
                                const colTasks = getColumnTasks(col.id);
                                return (
                                    <div key={col.id} id={col.id} className={clsx('w-[320px] rounded-2xl border bg-gray-50/50 flex flex-col', col.color)}>
                                        <div className={clsx('flex items-center justify-between px-4 py-3 rounded-t-2xl', col.headerBg)}>
                                            <div className="flex items-center gap-2">
                                                <h3 className={clsx('font-bold text-sm', col.headerColor)}>{col.title}</h3>
                                                <span className={clsx('text-xs font-bold px-2 py-0.5 rounded-full bg-white/60', col.headerColor)}>{colTasks.length}</span>
                                            </div>
                                            <button onClick={() => { setQuickAddCol(col.id); setQuickAddTitle(''); }}
                                                className="text-gray-400 hover:text-unbox-dark p-1 rounded-md hover:bg-white/60 transition-colors"><Plus size={16} /></button>
                                        </div>

                                        {quickAddCol === col.id && (
                                            <div className="mx-3 mt-3 p-2 bg-white rounded-xl border border-gray-200 shadow-sm">
                                                <input autoFocus value={quickAddTitle} onChange={e => setQuickAddTitle(e.target.value)}
                                                    onKeyDown={e => { if (e.key === 'Enter') handleQuickAdd(col.id); if (e.key === 'Escape') setQuickAddCol(null); }}
                                                    placeholder="Название задачи..." className="w-full px-2 py-1.5 text-sm outline-none" />
                                                <div className="flex justify-end gap-1 mt-1">
                                                    <button onClick={() => setQuickAddCol(null)} className="px-2 py-1 text-xs text-gray-400 hover:text-gray-600">Отмена</button>
                                                    <button onClick={() => handleQuickAdd(col.id)} className="px-3 py-1 text-xs font-medium text-white bg-unbox-green rounded-md hover:bg-unbox-dark">Создать</button>
                                                </div>
                                            </div>
                                        )}

                                        <SortableContext items={colTasks.map(t => t.id)} strategy={verticalListSortingStrategy}>
                                            <div className="flex-1 p-3 space-y-2.5 overflow-y-auto min-h-[100px]">
                                                {colTasks.map(task => (
                                                    <SortableTaskCard key={task.id} task={task}
                                                        onEdit={() => setEditingTask(task)}
                                                        onDelete={() => { deleteTask(task.id); toast.success('Удалено'); }} />
                                                ))}
                                                {colTasks.length === 0 && (
                                                    <div className="flex-1 flex items-center justify-center text-gray-300 text-sm italic py-8 border-2 border-dashed border-gray-200 rounded-xl">
                                                        Перетащите сюда
                                                    </div>
                                                )}
                                            </div>
                                        </SortableContext>

                                        {col.id === 'DONE' && archivedCount > 0 && (
                                            <button onClick={() => setShowArchive(!showArchive)}
                                                className="mx-3 mb-3 flex items-center justify-center gap-1.5 text-xs text-gray-400 hover:text-gray-600 py-2 rounded-lg hover:bg-white/60">
                                                <Archive size={12} />{showArchive ? 'Скрыть архив' : `Показать архив (${archivedCount})`}
                                            </button>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                    <DragOverlay>{activeTask && <TaskCardView task={activeTask} isDragging />}</DragOverlay>
                </DndContext>
            )}

            {editingTask && (
                <TaskEditModal task={editingTask} admins={admins} onClose={() => setEditingTask(null)}
                    onSave={async (data) => {
                        if (editingTask.id) { await updateTask(editingTask.id, data); toast.success('Обновлено'); }
                        else { await addTask(data as any); toast.success('Создано'); }
                        setEditingTask(null);
                    }}
                    onDelete={editingTask.id ? async () => { await deleteTask(editingTask.id); setEditingTask(null); toast.success('Удалено'); } : undefined}
                />
            )}
        </div>
    );
}

// ── Sortable Card ────────────────────────────────────────────────────────────

function SortableTaskCard({ task, onEdit, onDelete }: { task: AdminTask; onEdit: () => void; onDelete: () => void }) {
    const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: task.id });
    const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.4 : 1 };
    return (
        <div ref={setNodeRef} style={style} {...attributes}>
            <TaskCardView task={task} onEdit={onEdit} onDelete={onDelete} dragListeners={listeners} />
        </div>
    );
}

function TaskCardView({ task, onEdit, onDelete, dragListeners, isDragging }: {
    task: AdminTask; onEdit?: () => void; onDelete?: () => void; dragListeners?: any; isDragging?: boolean;
}) {
    const pri = PRIORITY_LABELS[task.priority] || PRIORITY_LABELS.MEDIUM;
    const clDone = (task.checklist || []).filter(c => c.done).length;
    const clTotal = (task.checklist || []).length;

    return (
        <div onClick={onEdit} className={clsx(
            'bg-white p-3.5 rounded-xl border border-gray-100 cursor-pointer transition-all group relative',
            isDragging ? 'shadow-xl ring-2 ring-unbox-green' : 'shadow-[0_1px_3px_rgba(0,0,0,0.04)] hover:shadow-md hover:border-gray-200'
        )}>
            <div className="flex items-start justify-between mb-2">
                <div className="flex items-center gap-1.5 flex-wrap">
                    <span className={clsx('text-[10px] uppercase tracking-wide font-bold px-1.5 py-0.5 rounded border', pri.color)}>{pri.label}</span>
                    {(task.labels || []).map(l => {
                        const opt = LABEL_OPTIONS.find(o => o.value === l);
                        return opt ? <span key={l} className={clsx('text-[10px] font-medium px-1.5 py-0.5 rounded border', opt.color)}>{opt.label}</span> : null;
                    })}
                </div>
                <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                    <div {...dragListeners} className="text-gray-300 hover:text-gray-500 p-1 cursor-grab active:cursor-grabbing" onClick={e => e.stopPropagation()}>
                        <GripVertical size={14} />
                    </div>
                    {onDelete && (
                        <button onClick={e => { e.stopPropagation(); onDelete(); }}
                            className="text-gray-300 hover:text-red-500 hover:bg-red-50 p-1 rounded-md transition-colors"><Trash2 size={13} /></button>
                    )}
                </div>
            </div>

            <p className={clsx('text-[13px] font-semibold leading-snug', task.status === 'DONE' ? 'text-gray-400 line-through' : 'text-unbox-dark')}>{task.title}</p>
            {task.description && <p className="text-xs text-gray-400 mt-1 line-clamp-2 leading-relaxed">{task.description}</p>}

            {clTotal > 0 && (
                <div className="mt-2 flex items-center gap-1.5 text-[11px] text-gray-400">
                    <CheckSquare size={12} className={clDone === clTotal ? 'text-green-500' : ''} />
                    <span>{clDone}/{clTotal}</span>
                    <div className="flex-1 h-1 bg-gray-100 rounded-full overflow-hidden">
                        <div className="h-full bg-unbox-green rounded-full transition-all" style={{ width: `${(clDone / clTotal) * 100}%` }} />
                    </div>
                </div>
            )}

            <div className="flex items-center justify-between mt-3 pt-2.5 border-t border-gray-50">
                {task.assigneeName ? (
                    <div className="flex items-center gap-1.5 text-[11px] font-medium text-gray-500 bg-gray-50 px-2 py-1 rounded-md">
                        <User size={11} /><span className="truncate max-w-[100px]">{task.assigneeName}</span>
                    </div>
                ) : <div />}
                {task.deadline && (() => {
                    const d = new Date(task.deadline);
                    let color = 'text-gray-400';
                    if (task.status !== 'DONE') {
                        if (isPast(d) && !isToday(d)) color = 'text-red-500 font-bold';
                        else if (isToday(d)) color = 'text-orange-500 font-bold';
                        else if (isTomorrow(d)) color = 'text-yellow-600';
                    }
                    return <div className={clsx('flex items-center gap-1 text-[11px]', color)}><Clock size={11} />{format(d, 'd MMM, HH:mm', { locale: ru })}</div>;
                })()}
            </div>
        </div>
    );
}

// ── Edit Modal ───────────────────────────────────────────────────────────────

function TaskEditModal({ task, admins, onClose, onSave, onDelete }: {
    task: AdminTask; admins: any[]; onClose: () => void; onSave: (data: any) => Promise<void>; onDelete?: () => Promise<void>;
}) {
    const isNew = !task.id;
    const [title, setTitle] = useState(task.title);
    const [description, setDescription] = useState(task.description || '');
    const [status, setStatus] = useState(task.status);
    const [priority, setPriority] = useState(task.priority);
    const [assigneeId, setAssigneeId] = useState(task.assigneeId || '');
    const [assigneeName, setAssigneeName] = useState(task.assigneeName || '');
    const [deadline, setDeadline] = useState(task.deadline ? format(new Date(task.deadline), "yyyy-MM-dd'T'HH:mm") : '');
    const [labels, setLabels] = useState<string[]>(task.labels || []);
    const [checklist, setChecklist] = useState<ChecklistItem[]>(task.checklist || []);
    const [newCheckItem, setNewCheckItem] = useState('');
    const [comments, setComments] = useState<AdminTaskComment[]>([]);
    const [newComment, setNewComment] = useState('');
    const [saving, setSaving] = useState(false);
    const [loadingComments, setLoadingComments] = useState(false);

    useEffect(() => {
        if (task.id) {
            setLoadingComments(true);
            adminTasksApi.listComments(task.id).then(setComments).catch(() => {}).finally(() => setLoadingComments(false));
        }
    }, [task.id]);

    const handleSave = async () => {
        if (!title.trim()) { toast.error('Введите название'); return; }
        setSaving(true);
        await onSave({ title: title.trim(), description, status, priority, assigneeId: assigneeId || undefined, assigneeName: assigneeName || undefined,
            deadline: deadline ? new Date(deadline).toISOString() : null, labels, checklist });
        setSaving(false);
    };

    const toggleLabel = (val: string) => setLabels(prev => prev.includes(val) ? prev.filter(l => l !== val) : [...prev, val]);
    const addCheckItem = () => { if (!newCheckItem.trim()) return; setChecklist(prev => [...prev, { id: Math.random().toString(36).slice(2, 8), text: newCheckItem.trim(), done: false }]); setNewCheckItem(''); };
    const toggleCheckItem = (id: string) => setChecklist(prev => prev.map(c => c.id === id ? { ...c, done: !c.done } : c));
    const removeCheckItem = (id: string) => setChecklist(prev => prev.filter(c => c.id !== id));
    const handleAddComment = async () => { if (!newComment.trim() || !task.id) return; const c = await adminTasksApi.addComment(task.id, newComment.trim()); setComments(prev => [c, ...prev]); setNewComment(''); };
    const handleAssigneeChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
        const val = e.target.value; setAssigneeId(val);
        const admin = admins.find(a => String((a as any).id || a.email) === val); setAssigneeName(admin?.name || '');
    };

    return (
        <div className="fixed inset-0 z-50 flex items-start justify-center pt-[5vh] bg-black/40 backdrop-blur-sm" onClick={onClose}>
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[85vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
                <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 sticky top-0 bg-white rounded-t-2xl z-10">
                    <h2 className="text-lg font-bold text-unbox-dark">{isNew ? 'Новая задача' : 'Редактирование'}</h2>
                    <button onClick={onClose} className="text-gray-400 hover:text-gray-600 p-1"><X size={20} /></button>
                </div>
                <div className="p-6 space-y-5">
                    <div>
                        <label className="block text-xs font-semibold text-gray-500 mb-1">Название *</label>
                        <input value={title} onChange={e => setTitle(e.target.value)} placeholder="Что нужно сделать?"
                            className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-unbox-green outline-none font-medium" />
                    </div>
                    <div>
                        <label className="block text-xs font-semibold text-gray-500 mb-1">Описание</label>
                        <textarea value={description} onChange={e => setDescription(e.target.value)} rows={3} placeholder="Детали..."
                            className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-unbox-green outline-none resize-none" />
                    </div>
                    <div className="grid grid-cols-3 gap-3">
                        <div>
                            <label className="block text-xs font-semibold text-gray-500 mb-1">Статус</label>
                            <select value={status} onChange={e => setStatus(e.target.value as TaskStatus)} className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm outline-none">
                                <option value="TODO">К выполнению</option><option value="IN_PROGRESS">В процессе</option><option value="DONE">Готово</option>
                            </select>
                        </div>
                        <div>
                            <label className="block text-xs font-semibold text-gray-500 mb-1">Приоритет</label>
                            <select value={priority} onChange={e => setPriority(e.target.value as TaskPriority)} className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm outline-none">
                                <option value="LOW">🟢 Низкий</option><option value="MEDIUM">🟡 Средний</option><option value="HIGH">🔴 Срочно</option>
                            </select>
                        </div>
                        <div>
                            <label className="block text-xs font-semibold text-gray-500 mb-1">Ответственный</label>
                            <select value={assigneeId} onChange={handleAssigneeChange} className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm outline-none">
                                <option value="">— Не назначен —</option>
                                {admins.map(a => <option key={a.email} value={String((a as any).id || a.email)}>{a.name}</option>)}
                            </select>
                        </div>
                    </div>
                    <div>
                        <label className="block text-xs font-semibold text-gray-500 mb-1">Дедлайн</label>
                        <input type="datetime-local" value={deadline} onChange={e => setDeadline(e.target.value)}
                            className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-unbox-green outline-none" />
                    </div>
                    <div>
                        <label className="block text-xs font-semibold text-gray-500 mb-2"><Tag size={12} className="inline mr-1" />Метки</label>
                        <div className="flex flex-wrap gap-2">
                            {LABEL_OPTIONS.map(opt => (
                                <button key={opt.value} onClick={() => toggleLabel(opt.value)} className={clsx(
                                    'text-xs font-medium px-2.5 py-1 rounded-lg border transition-all',
                                    labels.includes(opt.value) ? opt.color + ' ring-2 ring-offset-1 ring-gray-300' : 'bg-gray-50 text-gray-400 border-gray-100 hover:bg-gray-100'
                                )}>{opt.label}</button>
                            ))}
                        </div>
                    </div>
                    <div>
                        <label className="block text-xs font-semibold text-gray-500 mb-2"><CheckSquare size={12} className="inline mr-1" />Чеклист</label>
                        <div className="space-y-1.5">
                            {checklist.map(item => (
                                <div key={item.id} className="flex items-center gap-2 group/check">
                                    <button onClick={() => toggleCheckItem(item.id)} className="flex-shrink-0">
                                        {item.done ? <CheckSquare size={16} className="text-green-500" /> : <Square size={16} className="text-gray-300" />}
                                    </button>
                                    <span className={clsx('text-sm flex-1', item.done && 'line-through text-gray-400')}>{item.text}</span>
                                    <button onClick={() => removeCheckItem(item.id)} className="text-gray-200 hover:text-red-400 opacity-0 group-hover/check:opacity-100 transition-opacity"><X size={14} /></button>
                                </div>
                            ))}
                        </div>
                        <div className="flex gap-2 mt-2">
                            <input value={newCheckItem} onChange={e => setNewCheckItem(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') addCheckItem(); }}
                                placeholder="Добавить пункт..." className="flex-1 px-3 py-1.5 text-sm border border-gray-200 rounded-lg outline-none" />
                            <button onClick={addCheckItem} className="px-3 py-1.5 text-sm font-medium text-unbox-green hover:bg-unbox-light rounded-lg"><Plus size={14} /></button>
                        </div>
                    </div>
                    {task.id && (
                        <div>
                            <label className="block text-xs font-semibold text-gray-500 mb-2"><MessageSquare size={12} className="inline mr-1" />Комментарии</label>
                            <div className="flex gap-2 mb-3">
                                <input value={newComment} onChange={e => setNewComment(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') handleAddComment(); }}
                                    placeholder="Написать комментарий..." className="flex-1 px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none" />
                                <button onClick={handleAddComment} className="px-3 py-2 text-unbox-green hover:bg-unbox-light rounded-lg"><Send size={14} /></button>
                            </div>
                            {loadingComments ? <div className="text-sm text-gray-400 text-center py-3">Загрузка...</div>
                            : comments.length === 0 ? <div className="text-sm text-gray-300 text-center py-3 italic">Нет комментариев</div>
                            : <div className="space-y-2.5 max-h-48 overflow-y-auto">
                                {comments.map(c => (
                                    <div key={c.id} className="bg-gray-50 rounded-lg p-3">
                                        <div className="flex items-center justify-between mb-1">
                                            <span className="text-xs font-bold text-unbox-dark">{c.authorName}</span>
                                            <span className="text-[10px] text-gray-400">{format(new Date(c.createdAt), 'd MMM, HH:mm', { locale: ru })}</span>
                                        </div>
                                        <p className="text-sm text-gray-600">{c.text}</p>
                                    </div>
                                ))}
                            </div>}
                        </div>
                    )}
                </div>
                <div className="flex items-center justify-between px-6 py-4 border-t border-gray-100 sticky bottom-0 bg-white rounded-b-2xl">
                    {onDelete ? <button onClick={onDelete} className="text-sm text-red-400 hover:text-red-600 flex items-center gap-1"><Trash2 size={14} />Удалить</button> : <div />}
                    <div className="flex gap-2">
                        <Button variant="outline" onClick={onClose}>Отмена</Button>
                        <Button onClick={handleSave} disabled={saving}>{saving ? <><Loader2 size={14} className="animate-spin mr-1" />Сохранение...</> : isNew ? 'Создать' : 'Сохранить'}</Button>
                    </div>
                </div>
            </div>
        </div>
    );
}
