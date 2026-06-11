import { useEffect, useMemo, useState } from 'react';
import { Plus, Search, X, AlertTriangle, Clock, User as UserIcon, ChevronDown } from 'lucide-react';
import { format as fmtDate } from 'date-fns';
import { ru } from 'date-fns/locale';
import { toast } from 'sonner';
import { adminTasksApi, type AdminTask } from '../../../api/adminTasks';
import { useUserStore } from '../../../store/userStore';
import { SwipeRow } from '../SwipeRow';
import { getRecurrence, withRecurrence, recurrenceLabel, nextDeadline, type Recurrence } from './taskRecurrence';

type FilterTab = 'mine' | 'team' | 'overdue' | 'all';
type StatusFilter = 'open' | 'all' | 'done';

const ADMIN_ROLES = new Set(['owner', 'senior_admin', 'admin']);
const isAssignableUser = (u: { role?: string; isAdmin?: boolean }) =>
    !!(u.isAdmin || (u.role && ADMIN_ROLES.has(u.role)));

/**
 * Mobile admin — task board (vertical list, not Kanban).
 *
 * Trello-style columns are hostile on phones; iOS Trello itself shows ONE
 * list at a time. We mirror that: filter chips at top behave like columns,
 * the page below is a clean vertical list. Status changes are tap-on-badge
 * or swipe — no drag-between-columns.
 *
 * Two scopes:
 *   - "Мои"        — current user is assignee
 *   - "Команды"    — anything assigned to *anyone* (admin overview)
 *   - "Просроч."   — has deadline + open + deadline < now
 *   - "Все"        — no filter (admin sees everything)
 *
 * Status filter is secondary (chip row): default "Открытые" hides DONE so
 * the list doesn't fill up with closed work; switch to "Все" or "Сделано"
 * when you want history.
 */
export function MobileAdminTasks() {
    const { currentUser, users, fetchUsers } = useUserStore();
    const [tasks, setTasks] = useState<AdminTask[]>([]);
    const [loading, setLoading] = useState(true);
    const [tab, setTab] = useState<FilterTab>('mine');
    const [statusFilter, setStatusFilter] = useState<StatusFilter>('open');
    const [query, setQuery] = useState('');
    const [openTask, setOpenTask] = useState<AdminTask | null>(null);
    const [creating, setCreating] = useState(false);

    useEffect(() => {
        if (!users || users.length === 0) fetchUsers().catch(() => {});
        reload();
    }, []);

    async function reload() {
        setLoading(true);
        try {
            const list = await adminTasksApi.list();
            setTasks(list);
        } catch {
            toast.error('Не удалось загрузить задачи');
        } finally {
            setLoading(false);
        }
    }

    const userById = useMemo(() => {
        const m = new Map<string, string>();
        for (const u of users || []) m.set(u.id, u.name || u.email);
        return m;
    }, [users]);

    const overdueCount = useMemo(() => tasks.filter(isOverdue).length, [tasks]);
    const myCount = useMemo(
        () => tasks.filter(t => t.assigneeId === currentUser?.id && t.status !== 'DONE').length,
        [tasks, currentUser?.id],
    );

    const filtered = useMemo(() => {
        let list = tasks;

        // Scope filter
        if (tab === 'mine') list = list.filter(t => t.assigneeId === currentUser?.id);
        else if (tab === 'team') list = list.filter(t => !!t.assigneeId);
        else if (tab === 'overdue') list = list.filter(isOverdue);
        // 'all' — no scope filter

        // Status filter
        if (statusFilter === 'open') list = list.filter(t => t.status !== 'DONE');
        else if (statusFilter === 'done') list = list.filter(t => t.status === 'DONE');

        // Search
        const q = query.trim().toLowerCase();
        if (q) list = list.filter(t =>
            t.title?.toLowerCase().includes(q)
            || t.description?.toLowerCase().includes(q)
            || t.assigneeName?.toLowerCase().includes(q)
        );

        // Sort: overdue first, then by deadline asc, then by sort_order, then by created_at desc.
        return [...list].sort((a, b) => {
            const ao = isOverdue(a) ? 0 : 1;
            const bo = isOverdue(b) ? 0 : 1;
            if (ao !== bo) return ao - bo;
            const ad = a.deadline ? new Date(a.deadline).getTime() : Infinity;
            const bd = b.deadline ? new Date(b.deadline).getTime() : Infinity;
            if (ad !== bd) return ad - bd;
            if (a.sortOrder !== b.sortOrder) return (a.sortOrder ?? 0) - (b.sortOrder ?? 0);
            return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
        });
    }, [tasks, tab, statusFilter, query, currentUser?.id]);

    /** Cycle through statuses: TODO → IN_PROGRESS → DONE → TODO.
     *  When a recurring task transitions into DONE, spawn the next iteration
     *  with a shifted deadline. The completed instance stays as a record. */
    async function advanceStatus(t: AdminTask) {
        const next = t.status === 'TODO' ? 'IN_PROGRESS' : t.status === 'IN_PROGRESS' ? 'DONE' : 'TODO';
        try {
            const updated = await adminTasksApi.update(t.id, { status: next });
            setTasks(prev => prev.map(x => x.id === t.id ? updated : x));
            if (next === 'DONE') {
                await maybeSpawnRecurring(t);
            }
            toast.success(
                next === 'DONE' ? 'Готово ✓'
                : next === 'IN_PROGRESS' ? 'Взята в работу'
                : 'Возвращена в открытые',
            );
        } catch {
            toast.error('Не удалось обновить');
        }
    }

    async function maybeSpawnRecurring(t: AdminTask) {
        const rec = getRecurrence(t);
        if (!rec) return;
        const prevDeadline = t.deadline ? new Date(t.deadline) : null;
        const nextDl = nextDeadline(prevDeadline, rec);
        try {
            const created = await adminTasksApi.create({
                title: t.title,
                description: t.description,
                priority: t.priority,
                assigneeId: t.assigneeId,
                assigneeName: t.assigneeName,
                deadline: nextDl.toISOString(),
                labels: withRecurrence(t.labels, rec),
            });
            setTasks(prev => [created, ...prev]);
            toast.info(`Создана следующая: «${created.title}»`, { duration: 3500 });
        } catch {
            toast.error('Не удалось создать следующую регулярную');
        }
    }

    return (
        <>
            <div style={{ paddingTop: 12, paddingBottom: 'calc(96px + env(safe-area-inset-bottom, 0px))', display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div style={{ padding: '0 16px', display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12 }}>
                    <div>
                        <h1 style={{ fontSize: 24, fontWeight: 700, letterSpacing: '-0.02em', margin: 0 }}>
                            Задачи
                        </h1>
                        <p style={{ fontSize: 12, color: '#666', marginTop: 4 }}>
                            На тебе: {myCount} {overdueCount > 0 && (
                                <span style={{ color: '#C8253A', fontWeight: 700 }}>· просрочено: {overdueCount}</span>
                            )}
                        </p>
                    </div>
                </div>

                {/* Search */}
                <div style={{ padding: '0 16px' }}>
                    <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        background: '#F4F4F2',
                        borderRadius: 12,
                        padding: '10px 12px',
                        gap: 8,
                    }}>
                        <Search size={16} color="#999" />
                        <input
                            value={query}
                            onChange={e => setQuery(e.target.value)}
                            placeholder="Заголовок, исполнитель…"
                            style={{
                                flex: 1,
                                background: 'transparent',
                                border: 'none',
                                outline: 'none',
                                fontSize: 14,
                                fontFamily: 'inherit',
                                minWidth: 0,
                            }}
                        />
                    </div>
                </div>

                {/* Scope chips */}
                <div style={{ padding: '0 16px' }}>
                    <div style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 4, scrollbarWidth: 'none' }}>
                        {([
                            ['mine', 'Мои', myCount],
                            ['team', 'Команды', tasks.filter(t => !!t.assigneeId).length],
                            ['overdue', 'Просроч.', overdueCount],
                            ['all', 'Все', tasks.length],
                        ] as Array<[FilterTab, string, number]>).map(([id, label, count]) => {
                            const active = tab === id;
                            return (
                                <button
                                    key={id}
                                    onClick={() => setTab(id)}
                                    style={chipStyle(active, id === 'overdue' && count > 0 && !active)}
                                >
                                    {label}
                                    <span style={{
                                        marginLeft: 6,
                                        fontSize: 10,
                                        fontWeight: 700,
                                        opacity: 0.7,
                                    }}>{count}</span>
                                </button>
                            );
                        })}
                    </div>
                </div>

                {/* Status sub-filter */}
                <div style={{ padding: '0 16px' }}>
                    <div style={{ display: 'flex', gap: 6 }}>
                        {([
                            ['open', 'Открытые'],
                            ['all', 'Все'],
                            ['done', 'Сделано'],
                        ] as Array<[StatusFilter, string]>).map(([id, label]) => {
                            const active = statusFilter === id;
                            return (
                                <button
                                    key={id}
                                    onClick={() => setStatusFilter(id)}
                                    style={{
                                        background: active ? '#0E0E0E' : 'transparent',
                                        color: active ? '#fff' : '#666',
                                        border: active ? 'none' : '1px solid rgba(0,0,0,0.10)',
                                        borderRadius: 8,
                                        padding: '6px 10px',
                                        fontSize: 11,
                                        fontWeight: 600,
                                        cursor: 'pointer',
                                        fontFamily: 'inherit',
                                    }}
                                >
                                    {label}
                                </button>
                            );
                        })}
                    </div>
                </div>

                {loading && <div style={{ padding: '0 16px', color: '#666', fontSize: 14 }}>Загружаю…</div>}

                {!loading && filtered.length === 0 && (
                    <div style={{ padding: '0 16px' }}>
                        <div style={{
                            background: '#F4F4F2',
                            borderRadius: 14,
                            padding: 20,
                            textAlign: 'center',
                            color: '#666',
                            fontSize: 14,
                        }}>
                            {query
                                ? 'Ничего не нашлось'
                                : tab === 'mine' ? 'У тебя нет открытых задач 🎉'
                                : tab === 'overdue' ? 'Просроченных нет — отлично!'
                                : 'Список пуст. Тапни «+» чтобы создать.'}
                        </div>
                    </div>
                )}

                <div style={{ padding: '0 16px', display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {filtered.map(t => (
                        <SwipeRow
                            key={t.id}
                            primary={{
                                label: t.status === 'DONE' ? '↺ Открыть' : '✓ Готово',
                                color: t.status === 'DONE' ? '#666' : '#1B6E36',
                                onAction: () => {
                                    if (t.status === 'DONE') {
                                        adminTasksApi.update(t.id, { status: 'TODO' })
                                            .then(updated => setTasks(prev => prev.map(x => x.id === t.id ? updated : x)))
                                            .catch(() => toast.error('Не получилось'));
                                    } else {
                                        adminTasksApi.update(t.id, { status: 'DONE' })
                                            .then(async updated => {
                                                setTasks(prev => prev.map(x => x.id === t.id ? updated : x));
                                                toast.success('Готово ✓');
                                                await maybeSpawnRecurring(t);
                                            })
                                            .catch(() => toast.error('Не получилось'));
                                    }
                                },
                            }}
                            secondary={{
                                label: 'Открыть',
                                color: '#666',
                                onAction: () => setOpenTask(t),
                            }}
                        >
                            <TaskRow
                                task={t}
                                assigneeName={t.assigneeId ? (userById.get(t.assigneeId) || t.assigneeName) : undefined}
                                onTap={() => setOpenTask(t)}
                                onAdvanceStatus={() => advanceStatus(t)}
                            />
                        </SwipeRow>
                    ))}
                </div>
            </div>

            {/* Sticky create button */}
            <div style={{
                position: 'fixed',
                bottom: 'calc(72px + env(safe-area-inset-bottom, 0px))',
                left: '50%',
                transform: 'translateX(-50%)',
                width: '100%',
                maxWidth: 480,
                padding: '8px 16px',
                background: 'linear-gradient(to bottom, rgba(255,255,255,0) 0%, #fff 30%)',
                zIndex: 90,
                pointerEvents: 'none',
            }}>
                <button
                    onClick={() => setCreating(true)}
                    style={{
                        pointerEvents: 'auto',
                        width: '100%',
                        background: '#0E0E0E',
                        color: '#fff',
                        border: 'none',
                        borderRadius: 12,
                        padding: '14px 18px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: 8,
                        cursor: 'pointer',
                        fontFamily: 'inherit',
                        fontSize: 14,
                        fontWeight: 700,
                        boxShadow: '0 4px 16px rgba(0,0,0,0.18)',
                    }}
                >
                    <Plus size={16} /> Новая задача
                </button>
            </div>

            {openTask && (
                <TaskDetailSheet
                    task={openTask}
                    assigneeName={openTask.assigneeId ? (userById.get(openTask.assigneeId) || openTask.assigneeName) : undefined}
                    onClose={() => setOpenTask(null)}
                    onChange={updated => setTasks(prev => prev.map(x => x.id === updated.id ? updated : x))}
                    onDelete={id => setTasks(prev => prev.filter(x => x.id !== id))}
                />
            )}

            {creating && (
                <CreateTaskSheet
                    onClose={() => setCreating(false)}
                    onCreated={t => {
                        setTasks(prev => [t, ...prev]);
                        setCreating(false);
                    }}
                />
            )}
        </>
    );
}

/** One row in the task list. Title + assignee + due + priority/status badges. */
function TaskRow({ task: t, assigneeName, onTap, onAdvanceStatus }: {
    task: AdminTask;
    assigneeName?: string;
    onTap: () => void;
    onAdvanceStatus: () => void;
}) {
    const overdue = isOverdue(t);
    const due = t.deadline ? new Date(t.deadline) : null;
    const dueLabel = due ? humanizeDeadline(due) : null;
    const recurrence = getRecurrence(t);

    return (
        <div
            onClick={onTap}
            style={{
                background: '#fff',
                border: `1px solid ${overdue ? '#FCA5A5' : 'rgba(0,0,0,0.08)'}`,
                borderRadius: 12,
                padding: '12px 14px',
                opacity: t.status === 'DONE' ? 0.55 : 1,
                cursor: 'pointer',
            }}
            role="button"
        >
            {/* Title row */}
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                <div style={{
                    fontSize: 14, fontWeight: 700, lineHeight: 1.3, flex: 1,
                    textDecoration: t.status === 'DONE' ? 'line-through' : 'none',
                }}>
                    {t.priority === 'HIGH' && <span style={{ color: '#C8253A' }}>⚠ </span>}
                    {t.title}
                </div>
                {/* Tap-to-cycle status badge */}
                <button
                    onClick={(e) => { e.stopPropagation(); onAdvanceStatus(); }}
                    style={statusBadgeBtn(t.status)}
                >
                    {statusEmoji(t.status)} {statusLabel(t.status)}
                </button>
            </div>
            {/* Meta row */}
            <div style={{ display: 'flex', gap: 10, fontSize: 11, color: '#666', marginTop: 8, flexWrap: 'wrap' }}>
                {assigneeName && (
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                        <UserIcon size={11} /> {assigneeName}
                    </span>
                )}
                {dueLabel && (
                    <span style={{
                        display: 'inline-flex', alignItems: 'center', gap: 4,
                        color: overdue ? '#C8253A' : '#666',
                        fontWeight: overdue ? 700 : 500,
                    }}>
                        <Clock size={11} /> {dueLabel}
                    </span>
                )}
                {overdue && t.status !== 'DONE' && (
                    <span style={{
                        display: 'inline-flex', alignItems: 'center', gap: 4,
                        color: '#C8253A', fontWeight: 700,
                    }}>
                        <AlertTriangle size={11} /> просрочена
                    </span>
                )}
                {recurrence && (
                    <span style={{
                        display: 'inline-flex', alignItems: 'center', gap: 4,
                        background: '#E0E7FF', color: '#3730A3',
                        fontWeight: 700, padding: '2px 6px', borderRadius: 6,
                    }}>
                        🔁 {recurrenceLabel(recurrence)}
                    </span>
                )}
            </div>
        </div>
    );
}

/** Bottom-sheet showing the full task with edit + delete. */
function TaskDetailSheet({ task, assigneeName, onClose, onChange, onDelete }: {
    task: AdminTask;
    assigneeName?: string;
    onClose: () => void;
    onChange: (t: AdminTask) => void;
    onDelete: (id: string) => void;
}) {
    const { users } = useUserStore();
    const [busy, setBusy] = useState(false);
    const [pickAssignee, setPickAssignee] = useState(false);

    const setStatus = async (status: 'TODO' | 'IN_PROGRESS' | 'DONE') => {
        setBusy(true);
        try {
            const updated = await adminTasksApi.update(task.id, { status });
            onChange(updated);
        } catch { toast.error('Не получилось'); } finally { setBusy(false); }
    };
    const setPriority = async (priority: 'LOW' | 'MEDIUM' | 'HIGH') => {
        setBusy(true);
        try {
            const updated = await adminTasksApi.update(task.id, { priority });
            onChange(updated);
        } catch { toast.error('Не получилось'); } finally { setBusy(false); }
    };
    const setAssignee = async (uid: string | null, name: string | null) => {
        setBusy(true);
        try {
            const updated = await adminTasksApi.update(task.id, { assigneeId: uid ?? undefined, assigneeName: name ?? undefined });
            onChange(updated);
            setPickAssignee(false);
        } catch { toast.error('Не получилось'); } finally { setBusy(false); }
    };
    const setRecurrenceVal = async (rec: Recurrence | null) => {
        setBusy(true);
        try {
            const labels = withRecurrence(task.labels, rec);
            const updated = await adminTasksApi.update(task.id, { labels });
            onChange(updated);
        } catch { toast.error('Не получилось'); } finally { setBusy(false); }
    };
    const currentRecurrence = getRecurrence(task);
    const remove = async () => {
        if (!window.confirm('Удалить задачу?')) return;
        setBusy(true);
        try {
            await adminTasksApi.delete(task.id);
            onDelete(task.id);
            onClose();
            toast.success('Удалено');
        } catch { toast.error('Не получилось'); } finally { setBusy(false); }
    };

    return (
        <div onClick={onClose} style={overlayStyle}>
            <div onClick={e => e.stopPropagation()} style={sheetStyle}>
                {!pickAssignee ? (
                    <>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
                            <h3 style={{ fontSize: 18, fontWeight: 700, margin: 0, flex: 1, lineHeight: 1.3 }}>
                                {task.title}
                            </h3>
                            <button onClick={onClose} style={iconCloseBtn}>
                                <X size={22} />
                            </button>
                        </div>

                        {task.description && (
                            <div style={{ fontSize: 13, color: '#444', whiteSpace: 'pre-wrap', lineHeight: 1.45 }}>
                                {task.description}
                            </div>
                        )}

                        {/* Status row */}
                        <div>
                            <div style={fieldLabel}>Статус</div>
                            <div style={{ display: 'flex', gap: 6 }}>
                                {(['TODO', 'IN_PROGRESS', 'DONE'] as const).map(s => (
                                    <button
                                        key={s}
                                        onClick={() => setStatus(s)}
                                        disabled={busy}
                                        style={pickerBtn(task.status === s)}
                                    >
                                        {statusEmoji(s)} {statusLabel(s)}
                                    </button>
                                ))}
                            </div>
                        </div>

                        {/* Priority row */}
                        <div>
                            <div style={fieldLabel}>Приоритет</div>
                            <div style={{ display: 'flex', gap: 6 }}>
                                {(['LOW', 'MEDIUM', 'HIGH'] as const).map(p => (
                                    <button
                                        key={p}
                                        onClick={() => setPriority(p)}
                                        disabled={busy}
                                        style={pickerBtn(task.priority === p)}
                                    >
                                        {p === 'HIGH' ? '⚠ Срочно' : p === 'MEDIUM' ? 'Средне' : 'Низко'}
                                    </button>
                                ))}
                            </div>
                        </div>

                        {/* Assignee */}
                        <div>
                            <div style={fieldLabel}>Исполнитель</div>
                            <button
                                onClick={() => setPickAssignee(true)}
                                style={{
                                    width: '100%',
                                    background: '#fff',
                                    border: '1px solid rgba(0,0,0,0.10)',
                                    borderRadius: 10,
                                    padding: '10px 12px',
                                    fontSize: 14,
                                    fontFamily: 'inherit',
                                    color: '#0E0E0E',
                                    cursor: 'pointer',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'space-between',
                                }}
                            >
                                <span>{assigneeName || 'Не назначен'}</span>
                                <ChevronDown size={16} color="#999" />
                            </button>
                        </div>

                        {/* Recurrence */}
                        <div>
                            <div style={fieldLabel}>Регулярная задача</div>
                            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                                {([
                                    [null, 'Разовая'],
                                    ['daily', 'Ежедневно'],
                                    ['weekly', 'Еженедельно'],
                                    ['biweekly', 'Раз в 2 нед.'],
                                    ['monthly', 'Ежемесячно'],
                                ] as Array<[Recurrence | null, string]>).map(([rec, label]) => (
                                    <button
                                        key={String(rec)}
                                        onClick={() => setRecurrenceVal(rec)}
                                        disabled={busy}
                                        style={{
                                            ...pickerBtn(currentRecurrence === rec),
                                            flex: '0 0 auto',
                                            padding: '8px 12px',
                                            fontSize: 12,
                                        }}
                                    >
                                        {label}
                                    </button>
                                ))}
                            </div>
                            {currentRecurrence && (
                                <div style={{ fontSize: 11, color: '#666', marginTop: 6 }}>
                                    Когда отметишь как «Сделано» — автоматически создастся следующая задача с тем же исполнителем и сдвинутым дедлайном.
                                </div>
                            )}
                        </div>

                        {/* Deadline */}
                        {task.deadline && (
                            <div>
                                <div style={fieldLabel}>Дедлайн</div>
                                <div style={{ fontSize: 14, color: isOverdue(task) ? '#C8253A' : '#0E0E0E', fontWeight: 600 }}>
                                    {fmtDate(new Date(task.deadline), 'EEEE, d MMMM', { locale: ru })}
                                    {isOverdue(task) && <span style={{ marginLeft: 8 }}>· просрочена</span>}
                                </div>
                            </div>
                        )}

                        <div style={{ fontSize: 11, color: '#999', marginTop: 4 }}>
                            Создал: {task.createdByName} · {fmtDate(new Date(task.createdAt), 'd MMM, HH:mm', { locale: ru })}
                        </div>

                        {/* Delete */}
                        <button
                            onClick={remove}
                            disabled={busy}
                            style={{
                                background: 'transparent',
                                border: 'none',
                                color: '#C8253A',
                                fontSize: 13,
                                fontWeight: 600,
                                cursor: 'pointer',
                                padding: '8px 0',
                                fontFamily: 'inherit',
                                marginTop: 4,
                            }}
                        >
                            Удалить задачу
                        </button>

                        <div style={{ fontSize: 11, color: '#666', textAlign: 'center', borderTop: '1px solid rgba(0,0,0,0.06)', paddingTop: 10 }}>
                            Расширенное редактирование (комменты, чек-листы, файлы) — в десктопной админке.
                        </div>
                    </>
                ) : (
                    <>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <h3 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>Кому назначить</h3>
                            <button onClick={() => setPickAssignee(false)} style={iconCloseBtn}>
                                <X size={22} />
                            </button>
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: '55vh', overflow: 'auto' }}>
                            <button
                                onClick={() => setAssignee(null, null)}
                                disabled={busy}
                                style={pickerListItem(!task.assigneeId)}
                            >
                                Не назначен
                            </button>
                            {(users || [])
                                .filter(isAssignableUser)
                                .sort((a, b) => (a.name || '').localeCompare(b.name || '', 'ru'))
                                .map(u => (
                                    <button
                                        key={u.id}
                                        onClick={() => setAssignee(u.id, u.name || u.email)}
                                        disabled={busy}
                                        style={pickerListItem(task.assigneeId === u.id)}
                                    >
                                        <span>{u.name || u.email}</span>
                                        {u.role && <span style={{ fontSize: 11, opacity: 0.6 }}>{u.role}</span>}
                                    </button>
                                ))}
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}

/** Compact create-task form. Title + assignee + deadline chip + priority. */
function CreateTaskSheet({ onClose, onCreated }: {
    onClose: () => void;
    onCreated: (t: AdminTask) => void;
}) {
    const { users, currentUser } = useUserStore();
    const [title, setTitle] = useState('');
    const [description, setDescription] = useState('');
    const [assigneeId, setAssigneeId] = useState<string | null>(currentUser?.id ?? null);
    const [deadlinePreset, setDeadlinePreset] = useState<'today' | 'tomorrow' | 'week' | 'none'>('none');
    const [priority, setPriority] = useState<'LOW' | 'MEDIUM' | 'HIGH'>('MEDIUM');
    const [recurrence, setRecurrence] = useState<Recurrence | null>(null);
    const [busy, setBusy] = useState(false);

    const deadline = useMemo(() => {
        if (deadlinePreset === 'none') return null;
        const d = new Date();
        d.setHours(23, 59, 0, 0);
        if (deadlinePreset === 'tomorrow') d.setDate(d.getDate() + 1);
        if (deadlinePreset === 'week') d.setDate(d.getDate() + 7);
        return d;
    }, [deadlinePreset]);

    const submit = async () => {
        if (!title.trim()) {
            toast.error('Введи заголовок');
            return;
        }
        setBusy(true);
        try {
            const assignee = assigneeId ? (users || []).find(u => u.id === assigneeId) : null;
            // Backend's AdminTaskCreate has stricter defaults than the
            // optional-everywhere frontend payload — empty arrays for
            // participants/labels/checklist/attachments and an empty string
            // (not undefined) for description when not set. Sending undefined
            // makes the snake_case transformer drop the key entirely; the
            // backend Pydantic model handles that fine for non-required
            // fields, but we send explicit defaults to make the payload
            // deterministic and easier to debug.
            const created = await adminTasksApi.create({
                title: title.trim(),
                description: description.trim(),
                priority,
                status: 'TODO',
                assigneeId: assigneeId ?? undefined,
                assigneeName: assignee?.name ?? assignee?.email ?? undefined,
                deadline: deadline ? deadline.toISOString() : undefined,
                labels: recurrence ? withRecurrence([], recurrence) : [],
                participants: [],
                checklist: [],
                attachments: [],
                sortOrder: 0,
            });
            onCreated(created);
            toast.success('Задача создана');
        } catch (e: any) {
            // Surface validation errors verbatim — Pydantic 422 returns an
            // array of issues; default toast was eating those and showing
            // a generic message that hid the real problem.
            const detail = e?.response?.data?.detail;
            const msg = typeof detail === 'string'
                ? detail
                : Array.isArray(detail)
                    ? detail.map((d: any) => `${(d.loc || []).slice(-1).join('')}: ${d.msg}`).join('; ')
                    : (e?.message || 'Не удалось создать');
            toast.error(msg, { duration: 7000 });
            console.error('[task create]', e?.response?.data ?? e);
        } finally { setBusy(false); }
    };

    // Tasks are admin-team workflow only — assignee picker shows just admins,
    // owners, and senior admins. Specialists/clients aren't task targets here.
    const sortedUsers = useMemo(() => {
        return [...(users || [])]
            .filter(isAssignableUser)
            .sort((a, b) => (a.name || '').localeCompare(b.name || '', 'ru'));
    }, [users]);

    return (
        <div onClick={onClose} style={overlayStyle}>
            <div onClick={e => e.stopPropagation()} style={sheetStyle}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <h3 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>Новая задача</h3>
                    <button onClick={onClose} style={iconCloseBtn}>
                        <X size={22} />
                    </button>
                </div>

                <div>
                    <div style={fieldLabel}>Заголовок</div>
                    <input
                        value={title}
                        onChange={e => setTitle(e.target.value)}
                        placeholder="Что нужно сделать?"
                        autoFocus
                        style={textInput}
                    />
                </div>

                <div>
                    <div style={fieldLabel}>Описание (необязательно)</div>
                    <textarea
                        value={description}
                        onChange={e => setDescription(e.target.value)}
                        placeholder="Детали"
                        rows={3}
                        style={{ ...textInput, resize: 'none', fontFamily: 'inherit' }}
                    />
                </div>

                <div>
                    <div style={fieldLabel}>Кому</div>
                    <select
                        value={assigneeId ?? ''}
                        onChange={e => setAssigneeId(e.target.value || null)}
                        style={textInput}
                    >
                        <option value="">— Не назначать —</option>
                        {sortedUsers.map(u => (
                            <option key={u.id} value={u.id}>
                                {u.name || u.email}
                                {u.id === currentUser?.id ? ' (мне)' : ''}
                            </option>
                        ))}
                    </select>
                </div>

                <div>
                    <div style={fieldLabel}>Дедлайн</div>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        {([
                            ['none', 'Без срока'],
                            ['today', 'Сегодня'],
                            ['tomorrow', 'Завтра'],
                            ['week', 'Через неделю'],
                        ] as Array<['today' | 'tomorrow' | 'week' | 'none', string]>).map(([id, label]) => (
                            <button
                                key={id}
                                onClick={() => setDeadlinePreset(id)}
                                style={pickerBtn(deadlinePreset === id)}
                            >
                                {label}
                            </button>
                        ))}
                    </div>
                </div>

                <div>
                    <div style={fieldLabel}>Приоритет</div>
                    <div style={{ display: 'flex', gap: 6 }}>
                        {(['LOW', 'MEDIUM', 'HIGH'] as const).map(p => (
                            <button
                                key={p}
                                onClick={() => setPriority(p)}
                                style={pickerBtn(priority === p)}
                            >
                                {p === 'HIGH' ? '⚠ Срочно' : p === 'MEDIUM' ? 'Средне' : 'Низко'}
                            </button>
                        ))}
                    </div>
                </div>

                {/* Recurrence — turns the task into a "regular" one. When the
                    new task is marked DONE, the next occurrence is auto-created. */}
                <div>
                    <div style={fieldLabel}>Регулярная задача</div>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        {([
                            [null, 'Разовая'],
                            ['daily', 'Ежедневно'],
                            ['weekly', 'Еженедельно'],
                            ['biweekly', 'Раз в 2 нед.'],
                            ['monthly', 'Ежемесячно'],
                        ] as Array<[Recurrence | null, string]>).map(([rec, label]) => (
                            <button
                                key={String(rec)}
                                onClick={() => setRecurrence(rec)}
                                style={{
                                    ...pickerBtn(recurrence === rec),
                                    flex: '0 0 auto',
                                    padding: '8px 12px',
                                    fontSize: 12,
                                }}
                            >
                                {label}
                            </button>
                        ))}
                    </div>
                    {recurrence && (
                        <div style={{ fontSize: 11, color: '#666', marginTop: 6, lineHeight: 1.4 }}>
                            Следующая будет создана автоматически когда отметите эту как сделанную.
                            Дедлайн сдвинется на {recurrenceLabel(recurrence).toLowerCase()}.
                        </div>
                    )}
                </div>

                <button
                    onClick={submit}
                    disabled={busy || !title.trim()}
                    style={{
                        background: '#0E0E0E',
                        color: '#fff',
                        border: 'none',
                        borderRadius: 12,
                        padding: '14px 18px',
                        fontSize: 15,
                        fontWeight: 700,
                        cursor: busy ? 'wait' : 'pointer',
                        fontFamily: 'inherit',
                        opacity: busy || !title.trim() ? 0.6 : 1,
                    }}
                >
                    {busy ? 'Создаю…' : 'Создать задачу'}
                </button>
            </div>
        </div>
    );
}

// ─── helpers ──────────────────────────────────────────────────────
function isOverdue(t: AdminTask): boolean {
    if (t.status === 'DONE') return false;
    if (!t.deadline) return false;
    return new Date(t.deadline).getTime() < Date.now();
}

function statusLabel(s: string): string {
    return s === 'TODO' ? 'Открыта' : s === 'IN_PROGRESS' ? 'В работе' : 'Сделано';
}
function statusEmoji(s: string): string {
    return s === 'TODO' ? '○' : s === 'IN_PROGRESS' ? '◐' : '●';
}

function humanizeDeadline(d: Date): string {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today.getTime() + 86400000);
    const dDay = new Date(d);
    dDay.setHours(0, 0, 0, 0);
    const ms = dDay.getTime() - today.getTime();
    if (ms < 0) return `до ${fmtDate(d, 'd MMM', { locale: ru })}`;
    if (dDay.getTime() === today.getTime()) return 'до сегодня';
    if (dDay.getTime() === tomorrow.getTime()) return 'до завтра';
    if (ms < 7 * 86400000) return `до ${fmtDate(d, 'EEE', { locale: ru })}`;
    return `до ${fmtDate(d, 'd MMM', { locale: ru })}`;
}

const fieldLabel: React.CSSProperties = {
    fontSize: 11, fontWeight: 700, letterSpacing: '0.08em',
    textTransform: 'uppercase', color: '#999',
    marginBottom: 6,
};

const overlayStyle: React.CSSProperties = {
    position: 'fixed', inset: 0,
    background: 'rgba(0,0,0,0.55)',
    zIndex: 200,
    display: 'flex',
    alignItems: 'flex-end',
    justifyContent: 'center',
};

const sheetStyle: React.CSSProperties = {
    width: '100%',
    maxWidth: 480,
    background: '#fff',
    borderRadius: '20px 20px 0 0',
    padding: 20,
    paddingBottom: 'calc(20px + env(safe-area-inset-bottom, 0px))',
    display: 'flex',
    flexDirection: 'column',
    gap: 14,
    maxHeight: '85vh',
    overflow: 'auto',
};

const iconCloseBtn: React.CSSProperties = {
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    color: '#666',
    padding: 0,
};

const textInput: React.CSSProperties = {
    width: '100%',
    background: '#F4F4F2',
    border: 'none',
    borderRadius: 10,
    padding: '10px 12px',
    fontSize: 14,
    color: '#0E0E0E',
    outline: 'none',
    fontFamily: 'inherit',
    appearance: 'none',
    WebkitAppearance: 'none',
};

function chipStyle(active: boolean, urgent: boolean): React.CSSProperties {
    return {
        background: active ? '#0E0E0E' : urgent ? '#FEF2F2' : '#F4F4F2',
        color: active ? '#fff' : urgent ? '#C8253A' : '#0E0E0E',
        border: 'none',
        borderRadius: 10,
        padding: '8px 12px',
        fontSize: 12,
        fontWeight: 700,
        cursor: 'pointer',
        fontFamily: 'inherit',
        flex: '0 0 auto',
        whiteSpace: 'nowrap',
    };
}

function statusBadgeBtn(s: string): React.CSSProperties {
    const map: Record<string, { bg: string; fg: string }> = {
        TODO: { bg: '#F4F4F2', fg: '#666' },
        IN_PROGRESS: { bg: '#FEF3C7', fg: '#8A5A00' },
        DONE: { bg: '#E6F4EA', fg: '#1B6E36' },
    };
    const c = map[s] || map.TODO;
    return {
        background: c.bg,
        color: c.fg,
        border: 'none',
        borderRadius: 999,
        padding: '4px 10px',
        fontSize: 10,
        fontWeight: 700,
        cursor: 'pointer',
        fontFamily: 'inherit',
        whiteSpace: 'nowrap',
        flexShrink: 0,
    };
}

function pickerBtn(active: boolean): React.CSSProperties {
    return {
        background: active ? '#0E0E0E' : '#F4F4F2',
        color: active ? '#fff' : '#0E0E0E',
        border: 'none',
        borderRadius: 10,
        padding: '10px 12px',
        fontSize: 13,
        fontWeight: 700,
        cursor: 'pointer',
        fontFamily: 'inherit',
        flex: 1,
    };
}

function pickerListItem(active: boolean): React.CSSProperties {
    return {
        background: active ? '#0E0E0E' : '#fff',
        color: active ? '#fff' : '#0E0E0E',
        border: active ? 'none' : '1px solid rgba(0,0,0,0.10)',
        borderRadius: 10,
        padding: '12px 14px',
        fontSize: 14,
        fontWeight: 600,
        cursor: 'pointer',
        fontFamily: 'inherit',
        textAlign: 'left',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        gap: 10,
    };
}
