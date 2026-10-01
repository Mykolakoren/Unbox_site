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
import { format, isPast, isToday, differenceInDays } from 'date-fns';
import clsx from 'clsx';
import { Button } from '../../components/ui/Button';
import { Sheet } from '../../components/ui/Sheet';
import { PageHeader } from '../../components/ui/PageHeader';
import { toast } from 'sonner';
import { toastApiError } from '../../utils/errors';
import { ruCountWord } from '../../utils/plural';
import {
    DndContext, PointerSensor, TouchSensor,
    KeyboardSensor, useSensor, useSensors, type DragEndEvent,
    DragOverlay, useDroppable, pointerWithin, rectIntersection,
    type CollisionDetection,
} from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GH, GH_SANS, GH_MONO } from '../../hooks/useDesignFlag';
import { useConfirmDialog } from '../../components/ui/ConfirmDialogProvider';
import { SkeletonList } from '../../components/ui/Skeleton';
import { formatDayMonth, formatTime } from '../../utils/format';

// ── Constants ────────────────────────────────────────────────────────────────

const COLUMNS: { id: TaskStatus; title: string }[] = [
    { id: 'TODO', title: 'К выполнению' },
    { id: 'IN_PROGRESS', title: 'В процессе' },
    { id: 'DONE', title: 'Готово' },
];

// Метки — категории, а не статусы: без своих цветов (wave 1). Выбранная метка
// в окне задачи подсвечивается бирюзой «выбрано».
const LABEL_OPTIONS = [
    { value: 'cleaning', label: 'Уборка' },
    { value: 'finance', label: 'Финансы' },
    { value: 'clients', label: 'Клиенты' },
    { value: 'rooms', label: 'Кабинеты' },
    { value: 'purchase', label: 'Закупки' },
    { value: 'marketing', label: 'Маркетинг' },
    { value: 'tech', label: 'Техника' },
];

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
    const { confirm: askConfirm } = useConfirmDialog();

    useEffect(() => { fetchTasks(); }, [fetchTasks]);

    // Задача удаляется с сервера насовсем вместе с чек-листом и комментариями.
    // Раньше хватало одного промаха по крошечной корзине рядом с DONE —
    // теперь сначала вопрос, а «Удалено» только после ответа сервера (G8-04).
    const confirmDeleteTask = async (task: AdminTask): Promise<boolean> => {
        const name = task.title.length > 60 ? `${task.title.slice(0, 60).trimEnd()}…` : task.title;
        const ok = await askConfirm({
            title: `Удалить задачу «${name}»?`,
            message: 'Чек-лист и комментарии удалятся вместе с ней. Вернуть её не получится.',
            confirmLabel: 'Удалить',
            destructive: true,
        });
        if (!ok) return false;
        const deleted = await deleteTask(task.id);
        if (deleted) toast.success('Задача удалена');
        else toast.error('Не получилось удалить задачу');
        return deleted;
    };

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
            void handleMove(taskId, targetCol.id, false);
            return;
        }

        // 2. Dropped over another task?
        const overTask = tasks.find(t => t.id === overId);
        if (overTask && activeTask.status !== overTask.status) {
            void handleMove(taskId, overTask.status as TaskStatus, false);
        }
    };

    // Перемещение: стор сразу двигает карточку и возвращает её при ошибке.
    // «Перенесли» — только после ответа сервера (G8-admin-ops-M1).
    const handleMove = async (taskId: string, status: TaskStatus, announce = true) => {
        try {
            await moveTask(taskId, status);
            if (announce) toast.success(`Перенесли в «${COLUMNS.find(c => c.id === status)?.title}»`);
        } catch (e) {
            toastApiError(e, 'Не получилось перенести задачу');
        }
    };

    // Создание/правка из окна: true — сохранено (окно можно закрыть),
    // false — ошибка показана, введённое остаётся в окне.
    const saveTask = async (task: AdminTask, data: any): Promise<boolean> => {
        try {
            if (task.id) {
                await updateTask(task.id, data);
                toast.success('Задача сохранена');
            } else {
                await addTask(data);
                toast.success('Задача создана');
            }
            return true;
        } catch (e) {
            toastApiError(e, task.id ? 'Не получилось сохранить задачу' : 'Не получилось создать задачу');
            return false;
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
        try {
            await addTask({ title: quickAddTitle.trim(), status });
        } catch (e) {
            // Название не стираем — можно нажать «Создать» ещё раз.
            toastApiError(e, 'Не получилось создать задачу');
            return;
        }
        setQuickAddTitle('');
        setQuickAddCol(null);
        toast.success('Задача создана');
    };

    const activeTask = activeId ? tasks.find(t => t.id === activeId) : null;
    const hasFilters = !!searchQuery || !!filterPriority || !!filterAssignee;
    const emptyNewTask = { id: '', title: '', description: '', status: 'TODO', priority: 'MEDIUM', labels: [], checklist: [], attachments: [], participants: [], sortOrder: 0, createdBy: '', createdByName: '', createdAt: '', updatedAt: '' } as AdminTask;

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
                confirmDeleteTask={confirmDeleteTask}
                handleMove={handleMove}
                saveTask={saveTask}
                emptyNewTask={emptyNewTask}
            />
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
        try {
            await onSave({ title: title.trim(), description, status, priority, assigneeId: assigneeId || undefined, assigneeName: assigneeName || undefined,
                participants, startDate: startDate ? new Date(startDate + 'T00:00:00').toISOString() : null,
                deadline: deadline ? new Date(deadline + 'T23:59:59').toISOString() : null, labels, checklist, attachments });
        } finally {
            setSaving(false);
        }
    };

    // Клик мимо окна / Esc с заполненной формой — сначала спросить (G8-17).
    const { confirm: askClose } = useConfirmDialog();
    const dirty = title !== task.title || description !== (task.description || '') || status !== task.status
        || priority !== task.priority || assigneeId !== (task.assigneeId || '')
        || JSON.stringify(participants) !== JSON.stringify(task.participants || [])
        || JSON.stringify(labels) !== JSON.stringify(task.labels || [])
        || JSON.stringify(checklist) !== JSON.stringify(task.checklist || [])
        || JSON.stringify(attachments) !== JSON.stringify(task.attachments || [])
        || newCheckItem.trim() !== '' || newComment.trim() !== '';
    const requestClose = async () => {
        if (saving) return;
        if (!dirty) { onClose(); return; }
        const ok = await askClose({
            title: 'Закрыть без сохранения?',
            body: 'Изменения в задаче пропадут.',
            confirmLabel: 'Закрыть без сохранения',
            cancelLabel: 'Вернуться к задаче',
        });
        if (ok) onClose();
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
        <Sheet
            open
            onClose={requestClose}
            title={isNew ? 'Новая задача' : 'Задача'}
            width={680}
            footer={
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', flexWrap: 'wrap' }}>
                    <Button onClick={handleSave} loading={saving}>{isNew ? 'Создать задачу' : 'Сохранить'}</Button>
                    <Button variant="secondary" onClick={requestClose} disabled={saving}>Отмена</Button>
                    {onDelete && (
                        <Button variant="quiet" onClick={onDelete} disabled={saving} icon={<Trash2 size={16} aria-hidden="true" />} style={{ marginLeft: 'auto', color: 'var(--status-danger-fg)' }}>
                            Удалить
                        </Button>
                    )}
                </div>
            }
        >
                <div className="space-y-5">
                    <div>
                        <label className="block text-xs font-semibold text-ink-60 mb-1">Название *</label>
                        <input value={title} onChange={e => setTitle(e.target.value)} placeholder="Что нужно сделать?"
                            className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-unbox-green outline-none font-medium" />
                    </div>
                    <div>
                        <label className="block text-xs font-semibold text-ink-60 mb-1">Описание</label>
                        <textarea value={description} onChange={e => setDescription(e.target.value)} rows={3} placeholder="Детали..."
                            className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-unbox-green outline-none resize-none" />
                    </div>
                    <div className="grid grid-cols-3 gap-3">
                        <div>
                            <label className="block text-xs font-semibold text-ink-60 mb-1">Статус</label>
                            <select value={status} onChange={e => setStatus(e.target.value as TaskStatus)} className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm outline-none">
                                <option value="TODO">К выполнению</option><option value="IN_PROGRESS">В процессе</option><option value="DONE">Готово</option>
                            </select>
                        </div>
                        <div>
                            <label className="block text-xs font-semibold text-ink-60 mb-1">Приоритет</label>
                            <select value={priority} onChange={e => setPriority(e.target.value as TaskPriority)} className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm outline-none">
                                <option value="LOW">Низкий</option><option value="MEDIUM">Средний</option><option value="HIGH">Срочно</option>
                            </select>
                        </div>
                        <div>
                            <label className="block text-xs font-semibold text-ink-60 mb-1">Ответственный</label>
                            <select value={assigneeId} onChange={handleAssigneeChange} className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm outline-none">
                                <option value="">— Не назначен —</option>
                                {admins.map(a => <option key={a.email} value={String((a as any).id || a.email)}>{a.name}</option>)}
                            </select>
                        </div>
                    </div>
                    {/* Participants */}
                    <div>
                        <label className="block text-xs font-semibold text-ink-60 mb-1"><Users size={12} className="inline mr-1" />Участники</label>
                        <div className="flex flex-wrap gap-1.5 mb-2">
                            {participants.map(p => (
                                <span key={p.id} className="inline-flex items-center gap-1 text-xs font-medium bg-sunken text-ink-80 px-2 py-1 rounded-lg">
                                    {p.name}
                                    <button onClick={() => setParticipants(prev => prev.filter(x => x.id !== p.id))} aria-label={`Убрать участника ${p.name}`} className="text-ink-60 hover:text-[color:var(--status-danger-fg)]"><X size={12} aria-hidden="true" /></button>
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
                            <label className="block text-xs font-semibold text-ink-60 mb-1">Начало</label>
                            <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)}
                                className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-unbox-green outline-none" />
                        </div>
                        <div>
                            <label className="block text-xs font-semibold text-ink-60 mb-1">Дедлайн</label>
                            <input type="date" value={deadline} onChange={e => setDeadline(e.target.value)}
                                className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-unbox-green outline-none" />
                        </div>
                    </div>
                    <div>
                        <label className="block text-xs font-semibold text-ink-60 mb-2"><Tag size={12} className="inline mr-1" />Метки</label>
                        <div className="flex flex-wrap gap-2">
                            {LABEL_OPTIONS.map(opt => (
                                <button key={opt.value} onClick={() => toggleLabel(opt.value)} className={clsx(
                                    'text-xs font-medium px-2.5 py-1 rounded-lg border transition-all',
                                    labels.includes(opt.value) ? 'bg-accent-soft text-accent-ink border-accent' : 'bg-gray-50 text-ink-60 border-gray-100 hover:bg-gray-100'
                                )} aria-pressed={labels.includes(opt.value)}>{opt.label}</button>
                            ))}
                        </div>
                    </div>
                    <div>
                        <label className="block text-xs font-semibold text-ink-60 mb-2"><CheckSquare size={12} className="inline mr-1" />Чеклист</label>
                        <div className="space-y-1.5">
                            {checklist.map(item => (
                                <div key={item.id} className="flex items-center gap-2 group/check">
                                    <button onClick={() => toggleCheckItem(item.id)} aria-label={item.done ? `Снять отметку: ${item.text}` : `Отметить выполненным: ${item.text}`} aria-pressed={item.done} className="flex-shrink-0">
                                        {item.done ? <CheckSquare size={16} className="text-[color:var(--status-ok-fg)]" /> : <Square size={16} className="text-ink-60" />}
                                    </button>
                                    <span className={clsx('text-sm flex-1', item.done && 'line-through text-ink-60')}>{item.text}</span>
                                    <button onClick={() => removeCheckItem(item.id)} aria-label={`Удалить пункт: ${item.text}`} className="text-ink-60 hover:text-[color:var(--status-danger-fg)] opacity-0 group-hover/check:opacity-100 focus-visible:opacity-100 transition-opacity"><X size={14} aria-hidden="true" /></button>
                                </div>
                            ))}
                        </div>
                        <div className="flex gap-2 mt-2">
                            <input value={newCheckItem} onChange={e => setNewCheckItem(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') addCheckItem(); }}
                                placeholder="Добавить пункт..." className="flex-1 px-3 py-1.5 text-sm border border-gray-200 rounded-lg outline-none" />
                            <button onClick={addCheckItem} aria-label="Добавить пункт" className="px-3 py-1.5 text-sm font-medium text-unbox-green hover:bg-unbox-light rounded-lg"><Plus size={14} aria-hidden="true" /></button>
                        </div>
                    </div>
                    {/* Attachments */}
                    <div>
                        <label className="block text-xs font-semibold text-ink-60 mb-2"><Paperclip size={12} className="inline mr-1" />Вложения</label>
                        {attachments.length > 0 && (
                            <div className="space-y-1.5 mb-3">
                                {attachments.map(att => (
                                    <div key={att.id} className="flex items-center gap-2 group/att bg-gray-50 rounded-lg px-3 py-2">
                                        {att.type === 'link' ? <Link2 size={14} className="text-ink-60 flex-shrink-0" /> : <FileText size={14} className="text-ink-60 flex-shrink-0" />}
                                        <a href={att.url} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()}
                                            className="flex-1 text-sm text-ink-80 hover:underline truncate">{att.name}</a>
                                        {att.size != null && <span className="text-caption text-ink-60 flex-shrink-0">{(att.size / 1024).toFixed(0)} KB</span>}
                                        <button onClick={() => removeAttachment(att.id)}
                                            aria-label={`Удалить вложение ${att.name}`}
                                            className="text-ink-60 hover:text-[color:var(--status-danger-fg)] opacity-0 group-hover/att:opacity-100 focus-visible:opacity-100 transition-opacity flex-shrink-0"><X size={14} aria-hidden="true" /></button>
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
                            <button onClick={addLink} disabled={!newLinkUrl.trim()} aria-label="Добавить ссылку" className="px-3 py-1.5 text-sm font-medium text-ink-60 hover:bg-ink-05 rounded-lg disabled:opacity-30"><Link2 size={14} aria-hidden="true" /></button>
                        </div>
                        {/* Upload file */}
                        <label className={clsx(
                            'inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg cursor-pointer transition-colors',
                            uploadingFile ? 'text-ink-60 bg-gray-50' : 'text-ink-60 hover:bg-gray-100 border border-dashed border-gray-300'
                        )}>
                            {uploadingFile ? <><Loader2 size={14} className="animate-spin" /> Загружаем…</> : <><Upload size={14} /> Загрузить файл</>}
                            <input type="file" className="hidden" onChange={handleFileUpload} disabled={uploadingFile} />
                        </label>
                    </div>
                    {task.id && (
                        <div>
                            <label className="block text-xs font-semibold text-ink-60 mb-2"><MessageSquare size={12} className="inline mr-1" />Комментарии</label>
                            <div className="flex gap-2 mb-3">
                                <input value={newComment} onChange={e => setNewComment(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') handleAddComment(); }}
                                    placeholder="Написать комментарий..." className="flex-1 px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none" />
                                <button onClick={handleAddComment} aria-label="Отправить комментарий" className="px-3 py-2 text-unbox-green hover:bg-unbox-light rounded-lg"><Send size={14} aria-hidden="true" /></button>
                            </div>
                            {loadingComments ? <SkeletonList count={2} label="Загружаем комментарии" cardHeight={56} />
                            : comments.length === 0 ? <div className="text-sm text-ink-60 text-center py-3">Комментариев пока нет</div>
                            : <div className="space-y-2.5 max-h-48 overflow-y-auto">
                                {comments.map(c => (
                                    <div key={c.id} className="bg-gray-50 rounded-lg p-3">
                                        <div className="flex items-center justify-between mb-1">
                                            <span className="text-xs font-bold text-unbox-dark">{c.authorName}</span>
                                            <span className="text-caption text-ink-60">{formatDayMonth(c.createdAt)}, {formatTime(c.createdAt)}</span>
                                        </div>
                                        <p className="text-sm text-ink-80">{c.text}</p>
                                    </div>
                                ))}
                            </div>}
                        </div>
                    )}
                </div>
        </Sheet>
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
    confirmDeleteTask: (task: AdminTask) => Promise<boolean>;
    handleMove: (id: string, status: TaskStatus) => Promise<void>;
    saveTask: (task: AdminTask, data: any) => Promise<boolean>;
    emptyNewTask: AdminTask;
};

const GH_COLUMNS = COLUMNS;

function GridHouseAdminTasksBoard(p: GHTBProps) {
    const eyebrow: React.CSSProperties = { fontFamily: GH_MONO, fontSize: 12, letterSpacing: '0.06em', textTransform: 'uppercase', color: GH.ink60 };
    const [narrow, setNarrow] = useState(() => typeof window !== 'undefined' && window.innerWidth < 768);
    useEffect(() => {
        const h = () => setNarrow(window.innerWidth < 768);
        window.addEventListener('resize', h);
        return () => window.removeEventListener('resize', h);
    }, []);
    const [mobileTab, setMobileTab] = useState<TaskStatus>('TODO');

    return (
        <div style={{ color: GH.ink, fontFamily: GH_SANS, display: 'flex', flexDirection: 'column' }}>
            <div style={{ width: '100%', flex: 1, display: 'flex', flexDirection: 'column' }}>
                {/* HEAD — H1 = пункт меню; кнопка — общий Button (плюс в строку, G8-15). */}
                <PageHeader
                    title="Задачи"
                    description={p.loading ? undefined : `${ruCountWord(p.tasks.length, ['задача', 'задачи', 'задач'])} · готово ${p.tasks.filter(t => t.status === 'DONE').length}`}
                    actions={
                        <Button icon={<Plus size={16} aria-hidden="true" />} onClick={() => p.setEditingTask(p.emptyNewTask)}>
                            Новая задача
                        </Button>
                    }
                />

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
                            style={{ flex: narrow ? 1 : undefined, minWidth: 0, fontFamily: GH_MONO, fontSize: 12, letterSpacing: '0.06em', textTransform: 'uppercase', background: GH.paper, color: GH.ink, border: `1px solid ${GH.ink10}`, padding: '8px 10px', outline: 'none', cursor: 'pointer' }}
                        >
                            <option value="">Все приоритеты</option>
                            <option value="HIGH">Срочно</option>
                            <option value="MEDIUM">Средний</option>
                            <option value="LOW">Низкий</option>
                        </select>
                        <select
                            value={p.filterAssignee}
                            onChange={e => p.setFilterAssignee(e.target.value)}
                            style={{ flex: narrow ? 1 : undefined, minWidth: 0, fontFamily: GH_MONO, fontSize: 12, letterSpacing: '0.06em', textTransform: 'uppercase', background: GH.paper, color: GH.ink, border: `1px solid ${GH.ink10}`, padding: '8px 10px', outline: 'none', cursor: 'pointer' }}
                        >
                            <option value="">Все ответственные</option>
                            {p.admins.map((a: any) => (
                                <option key={a.email} value={String(a.id || a.email)}>{a.name}</option>
                            ))}
                        </select>
                        {p.hasFilters && (
                            <button
                                onClick={() => { p.setSearchQuery(''); p.setFilterPriority(''); p.setFilterAssignee(''); }}
                                style={{ fontFamily: GH_MONO, fontSize: 12, letterSpacing: '0.06em', textTransform: 'uppercase', background: 'transparent', color: GH.danger, border: `1px solid ${GH.danger}`, padding: '8px 10px', cursor: 'pointer', whiteSpace: 'nowrap' }}
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
                                        fontSize: 12,
                                        fontWeight: 600,
                                        letterSpacing: '0.06em',
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
                    <div style={{ flex: 1 }}>
                        <SkeletonList count={4} label="Загружаем задачи" />
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
                                                <h2 style={{ fontFamily: GH_SANS, fontSize: 16, fontWeight: 600, margin: 0 }}>
                                                    {col.title}
                                                </h2>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                                    <span style={{ fontFamily: GH_MONO, fontSize: 16, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                                                        {colTasks.length}
                                                    </span>
                                                    <button
                                                        onClick={() => { p.setQuickAddCol(col.id); p.setQuickAddTitle(''); }}
                                                        aria-label={`Добавить задачу в «${col.title}»`}
                                                        style={{ width: 32, height: 32, border: `1px solid ${GH.ink10}`, background: 'transparent', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                                                    >
                                                        <Plus size={14} aria-hidden="true" />
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
                                                            style={{ fontFamily: GH_MONO, fontSize: 12, letterSpacing: '0.06em', textTransform: 'uppercase', color: GH.ink60, background: 'transparent', border: 'none', padding: '4px 10px', cursor: 'pointer' }}
                                                        >
                                                            Отмена
                                                        </button>
                                                        <button
                                                            onClick={() => p.handleQuickAdd(col.id)}
                                                            style={{ fontFamily: GH_MONO, fontSize: 12, letterSpacing: '0.06em', textTransform: 'uppercase', color: GH.paper, background: GH.ink, border: 'none', padding: '4px 12px', cursor: 'pointer' }}
                                                        >
                                                            Создать
                                                        </button>
                                                    </div>
                                                </div>
                                            )}

                                            <SortableContext items={colTasks.map(t => t.id)} strategy={verticalListSortingStrategy}>
                                                <div style={{ flex: 1, padding: 12, display: 'flex', flexDirection: 'column', gap: 10, overflowY: 'auto', minHeight: 200 }}>
                                                    {colTasks.map(task => (
                                                        <GHSortableTaskCard
                                                            key={task.id}
                                                            task={task}
                                                            onEdit={() => p.setEditingTask(task)}
                                                            onDelete={() => { p.confirmDeleteTask(task); }}
                                                            onMove={(status) => { void p.handleMove(task.id, status); }}
                                                        />
                                                    ))}
                                                    {colTasks.length === 0 && (
                                                        <div style={{ padding: '40px 16px', border: `1px dashed ${GH.ink10}`, fontFamily: GH_MONO, fontSize: 12, letterSpacing: '0.06em', textTransform: 'uppercase', color: GH.ink60, textAlign: 'center' }}>
                                                            Задач нет
                                                        </div>
                                                    )}
                                                </div>
                                            </SortableContext>

                                            {col.id === 'DONE' && p.archivedCount > 0 && (
                                                <button
                                                    onClick={() => p.setShowArchive(!p.showArchive)}
                                                    style={{ margin: 12, padding: '10px 12px', border: `1px solid ${GH.ink10}`, background: 'transparent', cursor: 'pointer', fontFamily: GH_MONO, fontSize: 12, letterSpacing: '0.06em', textTransform: 'uppercase', color: GH.ink60, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
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
                        <DragOverlay>{p.activeTask && <GHTaskCardView task={p.activeTask} isDragging />}</DragOverlay>
                    </DndContext>
                )}

            </div>

            {p.editingTask && (
                <TaskEditModal
                    key={p.editingTask.id || 'new'}
                    task={p.editingTask}
                    admins={p.admins}
                    onClose={() => p.setEditingTask(null)}
                    onSave={async (data) => {
                        // Окно закрываем только после успешного сохранения.
                        const ok = await p.saveTask(p.editingTask!, data);
                        if (ok) p.setEditingTask(null);
                    }}
                    onDelete={p.editingTask.id ? async () => { if (await p.confirmDeleteTask(p.editingTask!)) p.setEditingTask(null); } : undefined}
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

function GHSortableTaskCard({ task, onEdit, onDelete, onMove }: {
    task: AdminTask; onEdit: () => void; onDelete: () => void; onMove: (status: TaskStatus) => void;
}) {
    const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: task.id });
    const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.4 : 1 };
    return (
        <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
            <GHTaskCardView task={task} onEdit={onEdit} onDelete={onDelete} onMove={onMove} dragListeners={listeners} />
        </div>
    );
}

function GHTaskCardView({ task, onEdit, onDelete, onMove, dragListeners, isDragging }: {
    task: AdminTask; onEdit?: () => void; onDelete?: () => void; onMove?: (status: TaskStatus) => void; dragListeners?: any; isDragging?: boolean;
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
                    <span style={{
                        fontFamily: GH_MONO, fontSize: 12, letterSpacing: '0.06em', textTransform: 'uppercase', fontWeight: 700,
                        color: priColor, border: `1px solid ${priColor}`, padding: '2px 6px',
                    }}>
                        {priLabel}
                    </span>
                    {(task.labels || []).slice(0, 2).map(l => {
                        const opt = LABEL_OPTIONS.find(o => o.value === l);
                        return opt ? (
                            <span key={l} style={{
                                fontFamily: GH_MONO, fontSize: 12, letterSpacing: '0.06em', textTransform: 'uppercase',
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
                            title={`Перенести в «${col.title}»`}
                            aria-label={`Перенести задачу в «${col.title}»`}
                            style={{
                                fontFamily: GH_MONO, fontSize: 12, letterSpacing: '0.06em', fontWeight: 700,
                                color: GH.ink60, background: 'transparent', border: `1px solid ${GH.ink10}`,
                                padding: '3px 6px', cursor: 'pointer', whiteSpace: 'nowrap',
                            }}
                        >
                            {col.id === 'TODO' ? 'Отложить' : col.id === 'IN_PROGRESS' ? 'В работу' : 'Готово'}
                        </button>
                    ))}
                    <div {...dragListeners} style={{ padding: 3, cursor: 'grab', color: GH.ink60 }} onClick={e => e.stopPropagation()}>
                        <GripVertical size={12} />
                    </div>
                    {onDelete && (
                        // Корзина отодвинута от ручки и кнопок перемещения чертой-разделителем;
                        // зона нажатия 32×32 (отрицательные поля держат высоту строки),
                        // а само удаление всё равно спрашивает подтверждение.
                        <>
                            <span aria-hidden style={{ width: 1, background: GH.ink10, marginLeft: 6 }} />
                            <button
                                onClick={e => { e.stopPropagation(); onDelete(); }}
                                title="Удалить задачу"
                                aria-label="Удалить задачу"
                                style={{
                                    width: 32, height: 32, margin: '-8px -9px -8px 0',
                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    background: 'transparent', border: 'none', cursor: 'pointer', color: GH.ink60,
                                }}
                                onMouseEnter={e => (e.currentTarget.style.color = GH.danger)}
                                onMouseLeave={e => (e.currentTarget.style.color = GH.ink60)}
                            >
                                <Trash2 size={12} />
                            </button>
                        </>
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
                    <span style={{ fontFamily: GH_MONO, fontSize: 12, fontVariantNumeric: 'tabular-nums', color: GH.ink60 }}>
                        {clDone}/{clTotal}
                    </span>
                    <div style={{ flex: 1, height: 2, background: GH.ink10, position: 'relative' }}>
                        <div style={{ position: 'absolute', inset: 0, width: `${(clDone / clTotal) * 100}%`, background: GH.ink }} />
                    </div>
                </div>
            )}

            {(task.attachments?.length > 0) && (
                <div style={{ marginTop: 8, fontFamily: GH_MONO, fontSize: 12, color: GH.ink60, display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Paperclip size={11} />
                    <span>{ruCountWord(task.attachments.length, ['вложение', 'вложения', 'вложений'])}</span>
                </div>
            )}

            {/* Footer row: assignee + deadline */}
            <div style={{ marginTop: 12, paddingTop: 10, borderTop: `1px solid ${GH.ink10}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                    {task.assigneeName && (
                        <span style={{ fontFamily: GH_MONO, fontSize: 12, letterSpacing: '0.06em', color: GH.ink, border: `1px solid ${GH.ink10}`, padding: '3px 8px', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                            <User size={10} />
                            {task.assigneeName}
                        </span>
                    )}
                    {(task.participants?.length > 0) && (
                        <span style={{ fontFamily: GH_MONO, fontSize: 12, letterSpacing: '0.06em', color: GH.ink60, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
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
                        <span style={{ fontFamily: GH_MONO, fontSize: 12, fontVariantNumeric: 'tabular-nums', color, display: 'inline-flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap' }}>
                            <Clock size={10} />
                            {formatDayMonth(d)} · {formatTime(d)}
                        </span>
                    );
                })()}
            </div>
        </div>
    );
}
