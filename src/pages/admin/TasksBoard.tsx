import { useState, useEffect, useMemo } from 'react';
import { useAdminTaskStore, type TaskStatus, type TaskPriority } from '../../store/adminTaskStore';
import type { AdminTask } from '../../api/adminTasks';
import { adminTasksApi, type AdminTaskComment, type ChecklistItem, type TaskAttachment } from '../../api/adminTasks';
import { useUserStore } from '../../store/userStore';
import {
    GripVertical, User, Users, Clock, Trash2, Plus, Search,
    X, MessageSquare, CheckSquare, Square, Tag, Send, Loader2,
    Archive, Link2, Paperclip, Upload, FileText,
} from 'lucide-react';
import { format, isPast, isToday, isTomorrow, differenceInDays } from 'date-fns';
import { ru } from 'date-fns/locale';
import clsx from 'clsx';
import { Button } from '../../components/ui/Button';
import { toast } from 'sonner';
import {
    DndContext, PointerSensor, TouchSensor,
    KeyboardSensor, useSensor, useSensors, type DragEndEvent,
    DragOverlay, useDroppable, pointerWithin, rectIntersection,
    type CollisionDetection,
} from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useDesignFlag, GH, GH_SANS, GH_MONO } from '../../hooks/useDesignFlag';

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
    const gridHouse = useDesignFlag();
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
        const activeTask = tasks.find(t => t.id === taskId);
        if (!activeTask) return;

        // 1. Dropped over a column droppable zone?
        const targetCol = COLUMNS.find(c => `column-${c.id}` === overId);
        if (targetCol && activeTask.status !== targetCol.id) {
            moveTask(taskId, targetCol.id);
            return;
        }

        // 2. Dropped over another task?
        const overTask = tasks.find(t => t.id === overId);
        if (overTask && activeTask.status !== overTask.status) {
            moveTask(taskId, overTask.status as TaskStatus);
        }
    };

    // Custom collision detection: prefer droppable columns, fall back to rect intersection
    const collisionDetection: CollisionDetection = (args) => {
        // First check pointer-within for droppable columns
        const pointerCollisions = pointerWithin(args);
        if (pointerCollisions.length > 0) return pointerCollisions;
        // Fallback to rect intersection
        return rectIntersection(args);
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
    const emptyNewTask = { id: '', title: '', description: '', status: 'TODO', priority: 'MEDIUM', labels: [], checklist: [], attachments: [], participants: [], sortOrder: 0, createdBy: '', createdByName: '', createdAt: '', updatedAt: '' } as AdminTask;

    if (gridHouse) {
        return (
            <GridHouseAdminTasksBoard
                tasks={tasks}
                loading={loading}
                admins={admins}
                editingTask={editingTask} setEditingTask={setEditingTask}
                quickAddCol={quickAddCol} setQuickAddCol={setQuickAddCol}
                quickAddTitle={quickAddTitle} setQuickAddTitle={setQuickAddTitle}
                searchQuery={searchQuery} setSearchQuery={setSearchQuery}
                filterPriority={filterPriority} setFilterPriority={setFilterPriority}
                filterAssignee={filterAssignee} setFilterAssignee={setFilterAssignee}
                showArchive={showArchive} setShowArchive={setShowArchive}
                activeTask={activeTask}
                sensors={sensors}
                collisionDetection={collisionDetection}
                handleDragStart={handleDragStart}
                handleDragEnd={handleDragEnd}
                handleQuickAdd={handleQuickAdd}
                getColumnTasks={getColumnTasks}
                archivedCount={archivedCount}
                hasFilters={hasFilters}
                deleteTask={deleteTask}
                moveTask={moveTask}
                updateTask={updateTask}
                addTask={addTask}
                emptyNewTask={emptyNewTask}
            />
        );
    }

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
                <DndContext sensors={sensors} collisionDetection={collisionDetection} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
                    <div className="flex-1 overflow-x-auto pb-4">
                        <div className="flex gap-4 min-w-max h-full items-stretch">
                            {COLUMNS.map(col => {
                                const colTasks = getColumnTasks(col.id);
                                return (
                                    <DroppableColumn key={col.id} colId={col.id} className={clsx('w-[320px] rounded-2xl border bg-gray-50/50 flex flex-col', col.color)}>
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
                                                        onDelete={() => { deleteTask(task.id); toast.success('Удалено'); }}
                                                        onMove={(status) => { moveTask(task.id, status); toast.success(`Перемещено в "${COLUMNS.find(c => c.id === status)?.title}"`); }} />
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
                                    </DroppableColumn>
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

// ── Droppable Column ─────────────────────────────────────────────────────────

function DroppableColumn({ colId, children, className }: { colId: string; children: React.ReactNode; className?: string }) {
    const { setNodeRef, isOver } = useDroppable({ id: `column-${colId}` });
    return (
        <div ref={setNodeRef} className={clsx(className, isOver && 'ring-2 ring-unbox-green/40 bg-unbox-light/20')}>
            {children}
        </div>
    );
}

// ── Sortable Card ────────────────────────────────────────────────────────────

function SortableTaskCard({ task, onEdit, onDelete, onMove }: { task: AdminTask; onEdit: () => void; onDelete: () => void; onMove: (status: TaskStatus) => void }) {
    const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: task.id });
    const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.4 : 1 };
    return (
        <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
            <TaskCardView task={task} onEdit={onEdit} onDelete={onDelete} onMove={onMove} dragListeners={listeners} />
        </div>
    );
}

function TaskCardView({ task, onEdit, onDelete, onMove, dragListeners, isDragging }: {
    task: AdminTask; onEdit?: () => void; onDelete?: () => void; onMove?: (status: TaskStatus) => void; dragListeners?: any; isDragging?: boolean;
}) {
    const pri = PRIORITY_LABELS[task.priority] || PRIORITY_LABELS.MEDIUM;
    const clDone = (task.checklist || []).filter(c => c.done).length;
    const clTotal = (task.checklist || []).length;

    // Quick move buttons — show the two OTHER columns
    const moveTargets = COLUMNS.filter(c => c.id !== task.status);

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
                    {/* Quick move buttons */}
                    {onMove && moveTargets.map(col => (
                        <button
                            key={col.id}
                            onClick={e => { e.stopPropagation(); onMove(col.id); }}
                            title={`Переместить в "${col.title}"`}
                            className={clsx(
                                'text-[9px] font-bold px-1.5 py-0.5 rounded-md border transition-colors',
                                col.id === 'TODO' ? 'text-slate-500 border-slate-200 hover:bg-slate-100' :
                                col.id === 'IN_PROGRESS' ? 'text-blue-500 border-blue-200 hover:bg-blue-50' :
                                'text-emerald-500 border-emerald-200 hover:bg-emerald-50'
                            )}
                        >
                            {col.id === 'TODO' ? 'TODO' : col.id === 'IN_PROGRESS' ? 'WIP' : 'DONE'}
                        </button>
                    ))}
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

            {(task.attachments?.length > 0) && (
                <div className="mt-2 flex items-center gap-1.5 text-[11px] text-gray-400">
                    <Paperclip size={12} />
                    <span>{task.attachments.length} вложени{task.attachments.length === 1 ? 'е' : task.attachments.length < 5 ? 'я' : 'й'}</span>
                </div>
            )}

            <div className="flex items-center justify-between mt-3 pt-2.5 border-t border-gray-50">
                <div className="flex items-center gap-1 flex-wrap">
                    {task.assigneeName && (
                        <div className="flex items-center gap-1 text-[11px] font-medium text-gray-500 bg-gray-50 px-2 py-1 rounded-md">
                            <User size={11} /><span className="truncate max-w-[80px]">{task.assigneeName}</span>
                        </div>
                    )}
                    {(task.participants?.length > 0) && (
                        <div className="flex items-center gap-1 text-[11px] font-medium text-blue-500 bg-blue-50 px-2 py-1 rounded-md">
                            <Users size={11} />+{task.participants.length}
                        </div>
                    )}
                    {!task.assigneeName && !(task.participants?.length > 0) && <div />}
                </div>
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
    const [participants, setParticipants] = useState<{ id: string; name: string }[]>(task.participants || []);
    const [startDate, setStartDate] = useState(task.startDate ? format(new Date(task.startDate), "yyyy-MM-dd") : '');
    const [deadline, setDeadline] = useState(task.deadline ? format(new Date(task.deadline), "yyyy-MM-dd") : '');
    const [labels, setLabels] = useState<string[]>(task.labels || []);
    const [checklist, setChecklist] = useState<ChecklistItem[]>(task.checklist || []);
    const [newCheckItem, setNewCheckItem] = useState('');
    const [attachments, setAttachments] = useState<TaskAttachment[]>(task.attachments || []);
    const [newLinkUrl, setNewLinkUrl] = useState('');
    const [newLinkName, setNewLinkName] = useState('');
    const [uploadingFile, setUploadingFile] = useState(false);
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
            participants, startDate: startDate ? new Date(startDate + 'T00:00:00').toISOString() : null,
            deadline: deadline ? new Date(deadline + 'T23:59:59').toISOString() : null, labels, checklist, attachments });
        setSaving(false);
    };

    const toggleLabel = (val: string) => setLabels(prev => prev.includes(val) ? prev.filter(l => l !== val) : [...prev, val]);
    const addCheckItem = () => { if (!newCheckItem.trim()) return; setChecklist(prev => [...prev, { id: Math.random().toString(36).slice(2, 8), text: newCheckItem.trim(), done: false }]); setNewCheckItem(''); };
    const toggleCheckItem = (id: string) => setChecklist(prev => prev.map(c => c.id === id ? { ...c, done: !c.done } : c));
    const removeCheckItem = (id: string) => setChecklist(prev => prev.filter(c => c.id !== id));
    const removeAttachment = (id: string) => setAttachments(prev => prev.filter(a => a.id !== id));
    const addLink = () => {
        if (!newLinkUrl.trim()) return;
        let url = newLinkUrl.trim();
        if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
        const name = newLinkName.trim() || url.replace(/^https?:\/\//i, '').slice(0, 40);
        setAttachments(prev => [...prev, { id: Math.random().toString(36).slice(2, 8), type: 'link', name, url, createdAt: new Date().toISOString() }]);
        setNewLinkUrl(''); setNewLinkName('');
    };
    const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        if (file.size > 20 * 1024 * 1024) { toast.error('Файл слишком большой (макс. 20 МБ)'); return; }
        setUploadingFile(true);
        try {
            const res = await adminTasksApi.uploadFile(file);
            setAttachments(prev => [...prev, {
                id: Math.random().toString(36).slice(2, 8),
                type: 'file',
                name: res.name || file.name,
                url: res.url,
                size: file.size,
                createdAt: new Date().toISOString(),
            }]);
            toast.success('Файл загружен');
        } catch { toast.error('Ошибка загрузки файла'); }
        setUploadingFile(false);
        e.target.value = '';
    };
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
                    {/* Participants */}
                    <div>
                        <label className="block text-xs font-semibold text-gray-500 mb-1"><Users size={12} className="inline mr-1" />Участники</label>
                        <div className="flex flex-wrap gap-1.5 mb-2">
                            {participants.map(p => (
                                <span key={p.id} className="inline-flex items-center gap-1 text-xs font-medium bg-blue-50 text-blue-700 px-2 py-1 rounded-lg">
                                    {p.name}
                                    <button onClick={() => setParticipants(prev => prev.filter(x => x.id !== p.id))} className="text-blue-400 hover:text-red-500"><X size={12} /></button>
                                </span>
                            ))}
                        </div>
                        <select
                            value=""
                            onChange={e => {
                                const val = e.target.value;
                                if (!val) return;
                                const admin = admins.find(a => String((a as any).id || a.email) === val);
                                if (admin && !participants.find(p => p.id === val)) {
                                    setParticipants(prev => [...prev, { id: val, name: admin.name }]);
                                }
                            }}
                            className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm outline-none"
                        >
                            <option value="">+ Добавить участника</option>
                            {admins.filter(a => !participants.find(p => p.id === String((a as any).id || a.email))).map(a => (
                                <option key={a.email} value={String((a as any).id || a.email)}>{a.name}</option>
                            ))}
                        </select>
                    </div>
                    {/* Date range */}
                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className="block text-xs font-semibold text-gray-500 mb-1">Начало</label>
                            <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)}
                                className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-unbox-green outline-none" />
                        </div>
                        <div>
                            <label className="block text-xs font-semibold text-gray-500 mb-1">Дедлайн</label>
                            <input type="date" value={deadline} onChange={e => setDeadline(e.target.value)}
                                className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-unbox-green outline-none" />
                        </div>
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
                    {/* Attachments */}
                    <div>
                        <label className="block text-xs font-semibold text-gray-500 mb-2"><Paperclip size={12} className="inline mr-1" />Вложения</label>
                        {attachments.length > 0 && (
                            <div className="space-y-1.5 mb-3">
                                {attachments.map(att => (
                                    <div key={att.id} className="flex items-center gap-2 group/att bg-gray-50 rounded-lg px-3 py-2">
                                        {att.type === 'link' ? <Link2 size={14} className="text-blue-500 flex-shrink-0" /> : <FileText size={14} className="text-gray-400 flex-shrink-0" />}
                                        <a href={att.url} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()}
                                            className="flex-1 text-sm text-blue-600 hover:underline truncate">{att.name}</a>
                                        {att.size != null && <span className="text-[10px] text-gray-400 flex-shrink-0">{(att.size / 1024).toFixed(0)} KB</span>}
                                        <button onClick={() => removeAttachment(att.id)}
                                            className="text-gray-200 hover:text-red-400 opacity-0 group-hover/att:opacity-100 transition-opacity flex-shrink-0"><X size={14} /></button>
                                    </div>
                                ))}
                            </div>
                        )}
                        {/* Add link */}
                        <div className="flex gap-2 mb-2">
                            <input value={newLinkUrl} onChange={e => setNewLinkUrl(e.target.value)} placeholder="https://..."
                                onKeyDown={e => { if (e.key === 'Enter') addLink(); }}
                                className="flex-1 px-3 py-1.5 text-sm border border-gray-200 rounded-lg outline-none" />
                            <input value={newLinkName} onChange={e => setNewLinkName(e.target.value)} placeholder="Название (необяз.)"
                                onKeyDown={e => { if (e.key === 'Enter') addLink(); }}
                                className="w-36 px-3 py-1.5 text-sm border border-gray-200 rounded-lg outline-none" />
                            <button onClick={addLink} disabled={!newLinkUrl.trim()} className="px-3 py-1.5 text-sm font-medium text-blue-500 hover:bg-blue-50 rounded-lg disabled:opacity-30"><Link2 size={14} /></button>
                        </div>
                        {/* Upload file */}
                        <label className={clsx(
                            'inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg cursor-pointer transition-colors',
                            uploadingFile ? 'text-gray-400 bg-gray-50' : 'text-gray-500 hover:bg-gray-100 border border-dashed border-gray-300'
                        )}>
                            {uploadingFile ? <><Loader2 size={14} className="animate-spin" /> Загрузка...</> : <><Upload size={14} /> Загрузить файл</>}
                            <input type="file" className="hidden" onChange={handleFileUpload} disabled={uploadingFile} />
                        </label>
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

// ============================================================================
// Grid House variant — Vignelli/Bierut task index
// ============================================================================

type GHTBProps = {
    tasks: AdminTask[];
    loading: boolean;
    admins: any[];
    editingTask: AdminTask | null; setEditingTask: (t: AdminTask | null) => void;
    quickAddCol: TaskStatus | null; setQuickAddCol: (s: TaskStatus | null) => void;
    quickAddTitle: string; setQuickAddTitle: (v: string) => void;
    searchQuery: string; setSearchQuery: (v: string) => void;
    filterPriority: string; setFilterPriority: (v: string) => void;
    filterAssignee: string; setFilterAssignee: (v: string) => void;
    showArchive: boolean; setShowArchive: (v: boolean) => void;
    activeTask: AdminTask | null | undefined;
    sensors: any;
    collisionDetection: CollisionDetection;
    handleDragStart: (e: any) => void;
    handleDragEnd: (e: DragEndEvent) => void;
    handleQuickAdd: (status: TaskStatus) => Promise<void>;
    getColumnTasks: (status: TaskStatus) => AdminTask[];
    archivedCount: number;
    hasFilters: boolean;
    deleteTask: (id: string) => void;
    moveTask: (id: string, status: TaskStatus) => void;
    updateTask: (id: string, data: any) => Promise<any>;
    addTask: (data: any) => Promise<any>;
    emptyNewTask: AdminTask;
};

const GH_COLUMNS: { id: TaskStatus; num: string; title: string }[] = [
    { id: 'TODO', num: '01', title: 'К выполнению' },
    { id: 'IN_PROGRESS', num: '02', title: 'В процессе' },
    { id: 'DONE', num: '03', title: 'Готово' },
];

function GridHouseAdminTasksBoard(p: GHTBProps) {
    const eyebrow: React.CSSProperties = { fontFamily: GH_MONO, fontSize: 10, letterSpacing: '0.18em', textTransform: 'uppercase', color: GH.ink60 };
    const [narrow, setNarrow] = useState(() => typeof window !== 'undefined' && window.innerWidth < 768);
    useEffect(() => {
        const h = () => setNarrow(window.innerWidth < 768);
        window.addEventListener('resize', h);
        return () => window.removeEventListener('resize', h);
    }, []);
    const [mobileTab, setMobileTab] = useState<TaskStatus>('TODO');

    return (
        <div style={{ minHeight: '100vh', background: GH.paper, color: GH.ink, fontFamily: GH_SANS, display: 'flex', flexDirection: 'column' }}>
            <div style={{ maxWidth: 1600, width: '100%', margin: '0 auto', padding: narrow ? '16px' : 'clamp(24px, 4vw, 48px)', flex: 1, display: 'flex', flexDirection: 'column' }}>
                {/* HEAD */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: narrow ? 12 : 20, borderBottom: `2px solid ${GH.ink}`, paddingBottom: narrow ? 16 : 32, marginBottom: narrow ? 16 : 32 }}>
                    <div style={{ minWidth: 0, flex: 1 }}>
                        <div style={{ ...eyebrow, marginBottom: narrow ? 6 : 12 }}>Раздел · Задачи</div>
                        <h1 style={{ fontFamily: GH_SANS, fontSize: narrow ? 28 : 'clamp(36px, 4.5vw, 56px)', fontWeight: 800, letterSpacing: '-0.02em', lineHeight: 0.95, margin: 0 }}>
                            Рабочая доска.
                        </h1>
                        <div style={{ ...eyebrow, marginTop: narrow ? 8 : 12 }}>
                            {p.tasks.length} задач · {p.tasks.filter(t => t.status === 'DONE').length} завершено
                        </div>
                    </div>
                    <button
                        onClick={() => p.setEditingTask(p.emptyNewTask)}
                        style={{
                            fontFamily: GH_MONO,
                            fontSize: narrow ? 9 : 11,
                            letterSpacing: '0.16em',
                            textTransform: 'uppercase',
                            background: GH.ink,
                            color: GH.paper,
                            border: `1px solid ${GH.ink}`,
                            padding: narrow ? '10px 14px' : '14px 22px',
                            cursor: 'pointer',
                            whiteSpace: 'nowrap',
                        }}
                    >
                        <Plus size={narrow ? 11 : 12} style={{ verticalAlign: 'middle', marginRight: 6 }} />
                        {narrow ? 'Создать' : 'Новая задача'}
                    </button>
                </div>

                {/* FILTERS */}
                <div style={{
                    display: 'flex',
                    flexDirection: narrow ? 'column' : 'row',
                    flexWrap: 'wrap',
                    alignItems: narrow ? 'stretch' : 'center',
                    gap: narrow ? 10 : 24,
                    marginBottom: narrow ? 16 : 32,
                    paddingBottom: narrow ? 12 : 16,
                    borderBottom: `1px solid ${GH.ink10}`,
                }}>
                    <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 10,
                        flex: narrow ? 'none' : 1,
                        width: narrow ? '100%' : undefined,
                        minWidth: narrow ? 0 : 220,
                        maxWidth: narrow ? '100%' : 400,
                        border: narrow ? `1px solid ${GH.ink10}` : 'none',
                        padding: narrow ? '8px 12px' : 0,
                    }}>
                        <Search size={14} color={GH.ink60} style={{ flexShrink: 0 }} />
                        <input
                            value={p.searchQuery}
                            onChange={e => p.setSearchQuery(e.target.value)}
                            placeholder="Поиск задач…"
                            style={{ flex: 1, minWidth: 0, fontFamily: GH_SANS, fontSize: 14, background: 'transparent', border: 'none', outline: 'none', padding: '4px 0', color: GH.ink }}
                        />
                    </div>
                    <div style={{ display: 'flex', gap: narrow ? 8 : 24, flexWrap: 'wrap' }}>
                        <select
                            value={p.filterPriority}
                            onChange={e => p.setFilterPriority(e.target.value)}
                            style={{ flex: narrow ? 1 : undefined, minWidth: 0, fontFamily: GH_MONO, fontSize: narrow ? 10 : 11, letterSpacing: '0.12em', textTransform: 'uppercase', background: GH.paper, color: GH.ink, border: `1px solid ${GH.ink10}`, padding: '8px 10px', outline: 'none', cursor: 'pointer' }}
                        >
                            <option value="">Все приоритеты</option>
                            <option value="HIGH">Срочно</option>
                            <option value="MEDIUM">Средний</option>
                            <option value="LOW">Низкий</option>
                        </select>
                        <select
                            value={p.filterAssignee}
                            onChange={e => p.setFilterAssignee(e.target.value)}
                            style={{ flex: narrow ? 1 : undefined, minWidth: 0, fontFamily: GH_MONO, fontSize: narrow ? 10 : 11, letterSpacing: '0.12em', textTransform: 'uppercase', background: GH.paper, color: GH.ink, border: `1px solid ${GH.ink10}`, padding: '8px 10px', outline: 'none', cursor: 'pointer' }}
                        >
                            <option value="">Все ответственные</option>
                            {p.admins.map((a: any) => (
                                <option key={a.email} value={String(a.id || a.email)}>{a.name}</option>
                            ))}
                        </select>
                        {p.hasFilters && (
                            <button
                                onClick={() => { p.setSearchQuery(''); p.setFilterPriority(''); p.setFilterAssignee(''); }}
                                style={{ fontFamily: GH_MONO, fontSize: narrow ? 10 : 11, letterSpacing: '0.12em', textTransform: 'uppercase', background: 'transparent', color: GH.danger, border: `1px solid ${GH.danger}`, padding: '8px 10px', cursor: 'pointer', whiteSpace: 'nowrap' }}
                            >
                                <X size={11} style={{ verticalAlign: 'middle', marginRight: 4 }} />
                                Сброс
                            </button>
                        )}
                    </div>
                </div>

                {/* Mobile column tabs */}
                {narrow && !p.loading && (
                    <div style={{ display: 'flex', gap: 0, marginBottom: 12, border: `2px solid ${GH.ink}` }}>
                        {GH_COLUMNS.map((col) => {
                            const colTasks = p.getColumnTasks(col.id);
                            const active = mobileTab === col.id;
                            return (
                                <button
                                    key={col.id}
                                    onClick={() => setMobileTab(col.id)}
                                    style={{
                                        flex: 1,
                                        padding: '10px 8px',
                                        border: 'none',
                                        borderLeft: col.id !== 'TODO' ? `2px solid ${GH.ink}` : 'none',
                                        background: active ? GH.ink : 'transparent',
                                        color: active ? GH.paper : GH.ink,
                                        fontFamily: GH_MONO,
                                        fontSize: 9,
                                        fontWeight: 600,
                                        letterSpacing: '0.12em',
                                        textTransform: 'uppercase',
                                        cursor: 'pointer',
                                        display: 'flex',
                                        flexDirection: 'column',
                                        alignItems: 'center',
                                        gap: 2,
                                    }}
                                >
                                    <span>{col.title}</span>
                                    <span style={{ fontSize: 14, fontWeight: 700 }}>{colTasks.length}</span>
                                </button>
                            );
                        })}
                    </div>
                )}

                {/* BOARD */}
                {p.loading ? (
                    <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <Loader2 className="animate-spin" size={24} color={GH.ink60} />
                    </div>
                ) : (
                    <DndContext sensors={p.sensors} collisionDetection={p.collisionDetection} onDragStart={p.handleDragStart} onDragEnd={p.handleDragEnd}>
                        <div style={{ flex: 1, overflowX: narrow ? 'visible' : 'auto', paddingBottom: 16 }}>
                            <div style={{
                                display: 'grid',
                                gridTemplateColumns: narrow ? '1fr' : 'repeat(3, 1fr)',
                                gap: 0,
                                border: `2px solid ${GH.ink}`,
                                height: '100%',
                            }}>
                                {GH_COLUMNS.filter(col => !narrow || col.id === mobileTab).map((col, colIdx) => {
                                    const colTasks = p.getColumnTasks(col.id);
                                    return (
                                        <GHDroppableColumn key={col.id} colId={col.id} borderLeft={!narrow && colIdx > 0}>
                                            {/* Column head */}
                                            <div style={{ padding: '16px 16px', borderBottom: `2px solid ${GH.ink}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                                <div>
                                                    <div style={{ fontFamily: GH_MONO, fontSize: 10, letterSpacing: '0.18em', textTransform: 'uppercase', color: GH.ink60 }}>
                                                        {col.num}
                                                    </div>
                                                    <div style={{ fontFamily: GH_SANS, fontSize: 18, fontWeight: 800, letterSpacing: '-0.01em', marginTop: 2 }}>
                                                        {col.title}
                                                    </div>
                                                </div>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                                    <span style={{ fontFamily: GH_MONO, fontSize: 16, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                                                        {colTasks.length}
                                                    </span>
                                                    <button
                                                        onClick={() => { p.setQuickAddCol(col.id); p.setQuickAddTitle(''); }}
                                                        style={{ width: 28, height: 28, border: `1px solid ${GH.ink10}`, background: 'transparent', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                                                    >
                                                        <Plus size={14} />
                                                    </button>
                                                </div>
                                            </div>

                                            {/* Quick add */}
                                            {p.quickAddCol === col.id && (
                                                <div style={{ margin: 12, border: `2px solid ${GH.ink}`, padding: 10, background: GH.paper }}>
                                                    <input
                                                        autoFocus
                                                        value={p.quickAddTitle}
                                                        onChange={e => p.setQuickAddTitle(e.target.value)}
                                                        onKeyDown={e => { if (e.key === 'Enter') p.handleQuickAdd(col.id); if (e.key === 'Escape') p.setQuickAddCol(null); }}
                                                        placeholder="Название задачи…"
                                                        style={{ width: '100%', fontFamily: GH_SANS, fontSize: 14, background: 'transparent', border: 'none', outline: 'none', padding: '6px 0', color: GH.ink }}
                                                    />
                                                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6, marginTop: 8 }}>
                                                        <button
                                                            onClick={() => p.setQuickAddCol(null)}
                                                            style={{ fontFamily: GH_MONO, fontSize: 10, letterSpacing: '0.14em', textTransform: 'uppercase', color: GH.ink60, background: 'transparent', border: 'none', padding: '4px 10px', cursor: 'pointer' }}
                                                        >
                                                            Отмена
                                                        </button>
                                                        <button
                                                            onClick={() => p.handleQuickAdd(col.id)}
                                                            style={{ fontFamily: GH_MONO, fontSize: 10, letterSpacing: '0.14em', textTransform: 'uppercase', color: GH.paper, background: GH.ink, border: 'none', padding: '4px 12px', cursor: 'pointer' }}
                                                        >
                                                            Создать
                                                        </button>
                                                    </div>
                                                </div>
                                            )}

                                            <SortableContext items={colTasks.map(t => t.id)} strategy={verticalListSortingStrategy}>
                                                <div style={{ flex: 1, padding: 12, display: 'flex', flexDirection: 'column', gap: 10, overflowY: 'auto', minHeight: 200 }}>
                                                    {colTasks.map((task, i) => (
                                                        <GHSortableTaskCard
                                                            key={task.id}
                                                            task={task}
                                                            index={i}
                                                            onEdit={() => p.setEditingTask(task)}
                                                            onDelete={() => { p.deleteTask(task.id); toast.success('Удалено'); }}
                                                            onMove={(status) => { p.moveTask(task.id, status); toast.success(`Перемещено в "${GH_COLUMNS.find(c => c.id === status)?.title}"`); }}
                                                        />
                                                    ))}
                                                    {colTasks.length === 0 && (
                                                        <div style={{ padding: '40px 16px', border: `1px dashed ${GH.ink10}`, fontFamily: GH_MONO, fontSize: 10, letterSpacing: '0.16em', textTransform: 'uppercase', color: GH.ink60, textAlign: 'center' }}>
                                                            Пусто
                                                        </div>
                                                    )}
                                                </div>
                                            </SortableContext>

                                            {col.id === 'DONE' && p.archivedCount > 0 && (
                                                <button
                                                    onClick={() => p.setShowArchive(!p.showArchive)}
                                                    style={{ margin: 12, padding: '10px 12px', border: `1px solid ${GH.ink10}`, background: 'transparent', cursor: 'pointer', fontFamily: GH_MONO, fontSize: 10, letterSpacing: '0.14em', textTransform: 'uppercase', color: GH.ink60, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
                                                >
                                                    <Archive size={12} />
                                                    {p.showArchive ? 'Скрыть архив' : `Архив · ${p.archivedCount}`}
                                                </button>
                                            )}
                                        </GHDroppableColumn>
                                    );
                                })}
                            </div>
                        </div>
                        <DragOverlay>{p.activeTask && <GHTaskCardView task={p.activeTask} index={0} isDragging />}</DragOverlay>
                    </DndContext>
                )}

                {/* Footer */}
                <div style={{ borderTop: `2px solid ${GH.ink}`, paddingTop: 16, marginTop: 24, display: 'flex', justifyContent: 'space-between', ...eyebrow }}>
                    <span>Unbox · Задачи · {new Date().getFullYear()}</span>
                    <span>{p.tasks.length} позиций</span>
                </div>
            </div>

            {p.editingTask && (
                <TaskEditModal
                    task={p.editingTask}
                    admins={p.admins}
                    onClose={() => p.setEditingTask(null)}
                    onSave={async (data) => {
                        if (p.editingTask!.id) { await p.updateTask(p.editingTask!.id, data); toast.success('Обновлено'); }
                        else { await p.addTask(data as any); toast.success('Создано'); }
                        p.setEditingTask(null);
                    }}
                    onDelete={p.editingTask.id ? async () => { await p.deleteTask(p.editingTask!.id); p.setEditingTask(null); toast.success('Удалено'); } : undefined}
                />
            )}
        </div>
    );
}

function GHDroppableColumn({ colId, children, borderLeft }: { colId: string; children: React.ReactNode; borderLeft: boolean }) {
    const { setNodeRef, isOver } = useDroppable({ id: `column-${colId}` });
    return (
        <div
            ref={setNodeRef}
            style={{
                display: 'flex',
                flexDirection: 'column',
                borderLeft: borderLeft ? `1px solid ${GH.ink10}` : 'none',
                background: isOver ? GH.ink5 : 'transparent',
                transition: 'background 150ms',
                minHeight: 500,
            }}
        >
            {children}
        </div>
    );
}

function GHSortableTaskCard({ task, index, onEdit, onDelete, onMove }: {
    task: AdminTask; index: number; onEdit: () => void; onDelete: () => void; onMove: (status: TaskStatus) => void;
}) {
    const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: task.id });
    const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.4 : 1 };
    return (
        <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
            <GHTaskCardView task={task} index={index} onEdit={onEdit} onDelete={onDelete} onMove={onMove} dragListeners={listeners} />
        </div>
    );
}

function GHTaskCardView({ task, index, onEdit, onDelete, onMove, dragListeners, isDragging }: {
    task: AdminTask; index: number; onEdit?: () => void; onDelete?: () => void; onMove?: (status: TaskStatus) => void; dragListeners?: any; isDragging?: boolean;
}) {
    const priColor = task.priority === 'HIGH' ? GH.danger : task.priority === 'LOW' ? GH.ink60 : GH.ink;
    const priLabel = task.priority === 'HIGH' ? 'Срочно' : task.priority === 'MEDIUM' ? 'Средний' : 'Низкий';
    const clDone = (task.checklist || []).filter(c => c.done).length;
    const clTotal = (task.checklist || []).length;

    const moveTargets = GH_COLUMNS.filter(c => c.id !== task.status);

    return (
        <div
            onClick={onEdit}
            style={{
                background: GH.paper,
                border: `1px solid ${isDragging ? GH.ink : GH.ink10}`,
                padding: 14,
                cursor: 'pointer',
                position: 'relative',
                boxShadow: isDragging ? `4px 4px 0 ${GH.ink}` : 'none',
                transition: 'border-color 120ms, box-shadow 120ms',
            }}
            onMouseEnter={(e) => { if (!isDragging) e.currentTarget.style.borderColor = GH.ink; }}
            onMouseLeave={(e) => { if (!isDragging) e.currentTarget.style.borderColor = GH.ink10; }}
        >
            {/* Top row: index + priority + move buttons */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10, gap: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                    <span style={{ fontFamily: GH_MONO, fontSize: 9, letterSpacing: '0.14em', color: GH.ink60, fontVariantNumeric: 'tabular-nums' }}>
                        №{String(index + 1).padStart(3, '0')}
                    </span>
                    <span style={{
                        fontFamily: GH_MONO, fontSize: 9, letterSpacing: '0.16em', textTransform: 'uppercase', fontWeight: 700,
                        color: priColor, border: `1px solid ${priColor}`, padding: '2px 6px',
                    }}>
                        {priLabel}
                    </span>
                    {(task.labels || []).slice(0, 2).map(l => {
                        const opt = LABEL_OPTIONS.find(o => o.value === l);
                        return opt ? (
                            <span key={l} style={{
                                fontFamily: GH_MONO, fontSize: 9, letterSpacing: '0.14em', textTransform: 'uppercase',
                                color: GH.ink60, border: `1px solid ${GH.ink10}`, padding: '2px 6px',
                            }}>
                                {opt.label}
                            </span>
                        ) : null;
                    })}
                </div>
                <div style={{ display: 'flex', gap: 2 }} onClick={e => e.stopPropagation()}>
                    {onMove && moveTargets.map(col => (
                        <button
                            key={col.id}
                            onClick={e => { e.stopPropagation(); onMove(col.id); }}
                            title={`→ ${col.title}`}
                            style={{
                                fontFamily: GH_MONO, fontSize: 9, letterSpacing: '0.12em', fontWeight: 700,
                                color: GH.ink60, background: 'transparent', border: `1px solid ${GH.ink10}`,
                                padding: '3px 6px', cursor: 'pointer',
                            }}
                        >
                            {col.id === 'TODO' ? 'TODO' : col.id === 'IN_PROGRESS' ? 'WIP' : 'DONE'}
                        </button>
                    ))}
                    <div {...dragListeners} style={{ padding: 3, cursor: 'grab', color: GH.ink60 }} onClick={e => e.stopPropagation()}>
                        <GripVertical size={12} />
                    </div>
                    {onDelete && (
                        <button
                            onClick={e => { e.stopPropagation(); onDelete(); }}
                            style={{ padding: 3, background: 'transparent', border: 'none', cursor: 'pointer', color: GH.ink60 }}
                            onMouseEnter={e => (e.currentTarget.style.color = GH.danger)}
                            onMouseLeave={e => (e.currentTarget.style.color = GH.ink60)}
                        >
                            <Trash2 size={12} />
                        </button>
                    )}
                </div>
            </div>

            {/* Title */}
            <div style={{
                fontFamily: GH_SANS,
                fontSize: 14,
                fontWeight: 700,
                lineHeight: 1.3,
                color: task.status === 'DONE' ? GH.ink60 : GH.ink,
                textDecoration: task.status === 'DONE' ? 'line-through' : 'none',
            }}>
                {task.title}
            </div>
            {task.description && (
                <div style={{ fontFamily: GH_SANS, fontSize: 12, lineHeight: 1.4, color: GH.ink60, marginTop: 6, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                    {task.description}
                </div>
            )}

            {/* Checklist progress */}
            {clTotal > 0 && (
                <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 8 }}>
                    <CheckSquare size={12} color={clDone === clTotal ? GH.ink : GH.ink60} />
                    <span style={{ fontFamily: GH_MONO, fontSize: 10, fontVariantNumeric: 'tabular-nums', color: GH.ink60 }}>
                        {clDone}/{clTotal}
                    </span>
                    <div style={{ flex: 1, height: 2, background: GH.ink10, position: 'relative' }}>
                        <div style={{ position: 'absolute', inset: 0, width: `${(clDone / clTotal) * 100}%`, background: GH.ink }} />
                    </div>
                </div>
            )}

            {(task.attachments?.length > 0) && (
                <div style={{ marginTop: 8, fontFamily: GH_MONO, fontSize: 10, color: GH.ink60, display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Paperclip size={11} />
                    <span>{task.attachments.length} вложений</span>
                </div>
            )}

            {/* Footer row: assignee + deadline */}
            <div style={{ marginTop: 12, paddingTop: 10, borderTop: `1px solid ${GH.ink10}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                    {task.assigneeName && (
                        <span style={{ fontFamily: GH_MONO, fontSize: 10, letterSpacing: '0.12em', color: GH.ink, border: `1px solid ${GH.ink10}`, padding: '3px 8px', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                            <User size={10} />
                            {task.assigneeName}
                        </span>
                    )}
                    {(task.participants?.length > 0) && (
                        <span style={{ fontFamily: GH_MONO, fontSize: 10, letterSpacing: '0.12em', color: GH.ink60, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                            <Users size={10} />+{task.participants.length}
                        </span>
                    )}
                </div>
                {task.deadline && (() => {
                    const d = new Date(task.deadline);
                    let color: string = GH.ink60;
                    if (task.status !== 'DONE') {
                        if (isPast(d) && !isToday(d)) color = GH.danger;
                        else if (isToday(d)) color = GH.ink;
                    }
                    return (
                        <span style={{ fontFamily: GH_MONO, fontSize: 10, fontVariantNumeric: 'tabular-nums', color, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                            <Clock size={10} />
                            {format(d, 'd MMM · HH:mm', { locale: ru })}
                        </span>
                    );
                })()}
            </div>
        </div>
    );
}
