import { useEffect, useMemo, useRef, useState } from 'react';
import { Plus, Search, AlertTriangle, Clock, User as UserIcon, ChevronDown, Circle, CircleDot, CircleCheck, Repeat, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { adminTasksApi, type AdminTask } from '../../../api/adminTasks';
import { useUserStore } from '../../../store/userStore';
import { SwipeRow } from '../SwipeRow';
import { getRecurrence, withRecurrence, recurrenceLabel, nextDeadline, type Recurrence } from './taskRecurrence';
import { Sheet } from '../../../components/ui/Sheet';
import { Button } from '../../../components/ui/Button';
import { Chip, Segmented } from '../../../components/ui/Chip';
import { Field, Input, Select, TextArea } from '../../../components/ui/Field';
import { EmptyState } from '../../../components/ui/EmptyState';
import { ErrorBar } from '../../../components/ui/ErrorBar';
import { SkeletonList } from '../../../components/ui/Skeleton';
import { useConfirmDialog } from '../../../components/ui/ConfirmDialogProvider';
import { COLOR, STATUS, Z } from '../../../design/tokens';
import { formatDateLabel, formatDayMonth, formatTime } from '../../../utils/format';

type FilterTab = 'mine' | 'team' | 'overdue' | 'all';
type StatusFilter = 'open' | 'all' | 'done';
type TaskStatus = AdminTask['status'];
type TaskPriority = AdminTask['priority'];

const ADMIN_ROLES = new Set(['owner', 'senior_admin', 'admin']);
const isAssignableUser = (u: { role?: string; isAdmin?: boolean }) =>
    !!(u.isAdmin || (u.role && ADMIN_ROLES.has(u.role)));

/** Роль по-русски — в выборе исполнителя был сырой код («senior_admin»). */
const ROLE_LABEL: Record<string, string> = {
    admin: 'Админ',
    senior_admin: 'Старший админ',
    owner: 'Владелец',
    specialist: 'Специалист',
    user: 'Клиент',
};

const PRIORITY_OPTIONS: { value: TaskPriority; label: string }[] = [
    { value: 'LOW', label: 'Низкий' },
    { value: 'MEDIUM', label: 'Средний' },
    { value: 'HIGH', label: 'Срочный' },
];

const RECURRENCE_OPTIONS: Array<[Recurrence | null, string]> = [
    [null, 'Разовая'],
    ['daily', 'Ежедневно'],
    ['weekly', 'Еженедельно'],
    ['biweekly', 'Раз в 2 недели'],
    ['monthly', 'Ежемесячно'],
];

/**
 * Mobile admin — task board (vertical list, not Kanban).
 *
 * Trello-style columns are hostile on phones; iOS Trello itself shows ONE
 * list at a time. We mirror that: filter chips at top behave like columns,
 * the page below is a clean vertical list. Status changes are tap-on-badge
 * or swipe — no drag-between-columns.
 *
 * Scopes:
 *   - "Мои"          — current user is assignee
 *   - "Команда"      — anything assigned to *anyone* (admin overview)
 *   - "Просроченные" — has deadline + open + deadline < now
 *   - "Все"          — no filter (admin sees everything)
 *
 * Status filter is secondary (chip row): default "Открытые" hides DONE so
 * the list doesn't fill up with closed work; switch to "Все" or "Сделано"
 * when you want history.
 *
 * Wave 1: шторки задачи и создания — на общем Sheet (кнопка «Создать задачу»
 * в подвале всегда видна); удаление — окном подтверждения, не confirm();
 * обращение «вы»; эмодзи (🎉 🔁 ⚠ ✓) → значки Lucide; токены вместо hex.
 */
export function MobileAdminTasks() {
    const { currentUser, users, fetchUsers } = useUserStore();
    const [tasks, setTasks] = useState<AdminTask[]>([]);
    const [loading, setLoading] = useState(true);
    const [failed, setFailed] = useState(false);
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
            setFailed(false);
        } catch {
            setFailed(true);
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
                next === 'DONE' ? 'Задача выполнена'
                : next === 'IN_PROGRESS' ? 'Задача взята в работу'
                : 'Задача снова открыта',
            );
        } catch {
            toast.error('Не удалось обновить задачу. Попробуйте ещё раз');
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
            toast.info(`Создали следующую: «${created.title}» до ${formatDayMonth(nextDl)}`, { duration: 3500 });
        } catch {
            toast.error('Не удалось создать следующую регулярную задачу');
        }
    }

    const emptyTitle = query
        ? 'Ничего не нашлось'
        : tab === 'mine' ? 'У вас нет открытых задач'
        : tab === 'overdue' ? 'Просроченных задач нет'
        : 'Задач пока нет';
    const emptyHint = query
        ? 'Попробуйте другой запрос.'
        : tab === 'overdue' ? undefined
        : 'Создайте задачу кнопкой «Новая задача».';

    return (
        <>
            <div style={{ paddingTop: 12, paddingBottom: 'calc(96px + env(safe-area-inset-bottom, 0px))', display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div style={{ padding: '0 16px', display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12 }}>
                    <div>
                        <h1 style={{ fontSize: 24, fontWeight: 600, letterSpacing: '-0.02em', margin: 0 }}>
                            Задачи
                        </h1>
                        <p style={{ fontSize: 14, color: 'var(--color-ink-60)', marginTop: 4 }}>
                            На вас: {myCount} {overdueCount > 0 && (
                                <span style={{ color: 'var(--status-danger-fg)', fontWeight: 600 }}>· просрочено: {overdueCount}</span>
                            )}
                        </p>
                    </div>
                </div>

                {/* Search */}
                <div style={{ padding: '0 16px' }}>
                    <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        background: 'var(--color-sunken)',
                        borderRadius: 12,
                        padding: '0 12px',
                        minHeight: 44,
                        gap: 8,
                    }}>
                        <Search size={16} color={COLOR.ink60} aria-hidden="true" />
                        <input
                            value={query}
                            onChange={e => setQuery(e.target.value)}
                            aria-label="Поиск задачи"
                            placeholder="Заголовок, исполнитель…"
                            style={{
                                flex: 1,
                                background: 'transparent',
                                border: 'none',
                                outline: 'none',
                                fontSize: 16,
                                fontFamily: 'inherit',
                                minWidth: 0,
                                color: 'var(--color-ink)',
                            }}
                        />
                    </div>
                </div>

                {/* Scope chips */}
                <div style={{ padding: '0 16px' }}>
                    <div role="group" aria-label="Чьи задачи" style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 4, scrollbarWidth: 'none' }}>
                        {([
                            ['mine', 'Мои', myCount],
                            ['team', 'Команда', tasks.filter(t => !!t.assigneeId).length],
                            ['overdue', 'Просроченные', overdueCount],
                            ['all', 'Все', tasks.length],
                        ] as Array<[FilterTab, string, number]>).map(([id, label, count]) => {
                            const active = tab === id;
                            const urgent = id === 'overdue' && count > 0 && !active;
                            return (
                                <Chip
                                    key={id}
                                    selected={active}
                                    onClick={() => setTab(id)}
                                    style={{ flexShrink: 0, color: urgent ? 'var(--status-danger-fg)' : undefined }}
                                >
                                    {label} · {count}
                                </Chip>
                            );
                        })}
                    </div>
                </div>

                {/* Status sub-filter */}
                <div style={{ padding: '0 16px' }}>
                    <Segmented<StatusFilter>
                        aria-label="Статус задач"
                        options={[
                            { value: 'open', label: 'Открытые' },
                            { value: 'all', label: 'Все' },
                            { value: 'done', label: 'Сделано' },
                        ]}
                        value={statusFilter}
                        onChange={setStatusFilter}
                    />
                </div>

                {failed && !loading && (
                    <div style={{ padding: '0 16px' }}>
                        <ErrorBar message="Не удалось загрузить задачи" onRetry={reload} />
                    </div>
                )}

                {loading && tasks.length === 0 && (
                    <div style={{ padding: '0 16px' }}>
                        <SkeletonList count={4} label="Загружаем задачи" cardHeight={72} />
                    </div>
                )}

                {!loading && !failed && filtered.length === 0 && (
                    <div style={{ padding: '0 16px' }}>
                        <EmptyState compact title={emptyTitle} hint={emptyHint} />
                    </div>
                )}

                <div style={{ padding: '0 16px', display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {filtered.map(t => (
                        <SwipeRow
                            key={t.id}
                            primary={{
                                label: t.status === 'DONE' ? 'Вернуть' : 'Готово',
                                color: t.status === 'DONE' ? STATUS.muted.fg : STATUS.ok.fg,
                                onAction: () => {
                                    if (t.status === 'DONE') {
                                        adminTasksApi.update(t.id, { status: 'TODO' })
                                            .then(updated => setTasks(prev => prev.map(x => x.id === t.id ? updated : x)))
                                            .catch(() => toast.error('Не удалось вернуть задачу. Попробуйте ещё раз'));
                                    } else {
                                        adminTasksApi.update(t.id, { status: 'DONE' })
                                            .then(async updated => {
                                                setTasks(prev => prev.map(x => x.id === t.id ? updated : x));
                                                toast.success('Задача выполнена');
                                                await maybeSpawnRecurring(t);
                                            })
                                            .catch(() => toast.error('Не удалось закрыть задачу. Попробуйте ещё раз'));
                                    }
                                },
                            }}
                            secondary={{
                                label: 'Открыть',
                                color: STATUS.muted.fg,
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
                background: 'linear-gradient(to bottom, rgba(253,253,251,0) 0%, var(--color-card) 30%)',
                zIndex: Z.sticky,
                pointerEvents: 'none',
            }}>
                <Button
                    block
                    icon={<Plus size={16} aria-hidden="true" />}
                    onClick={() => setCreating(true)}
                    style={{ pointerEvents: 'auto' }}
                >
                    Новая задача
                </Button>
            </div>

            {openTask && (
                <TaskDetailSheet
                    task={openTask}
                    assigneeName={openTask.assigneeId ? (userById.get(openTask.assigneeId) || openTask.assigneeName) : undefined}
                    onClose={() => setOpenTask(null)}
                    onChange={updated => {
                        setTasks(prev => prev.map(x => x.id === updated.id ? updated : x));
                        setOpenTask(updated);
                    }}
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
    const StatusIcon = statusIcon(t.status);

    return (
        <div
            onClick={onTap}
            onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onTap(); } }}
            style={{
                background: 'var(--color-card)',
                border: `1px solid ${overdue ? 'var(--status-danger-fg)' : 'var(--color-ink-08)'}`,
                borderRadius: 12,
                padding: '12px 14px',
                opacity: t.status === 'DONE' ? 0.7 : 1,
                cursor: 'pointer',
            }}
            role="button"
            tabIndex={0}
        >
            {/* Title row */}
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                <div style={{
                    fontSize: 14, fontWeight: 600, lineHeight: 1.3, flex: 1,
                    textDecoration: t.status === 'DONE' ? 'line-through' : 'none',
                }}>
                    {t.priority === 'HIGH' && (
                        <AlertTriangle size={14} aria-label="Срочная" style={{ color: 'var(--status-danger-fg)', marginRight: 4, verticalAlign: '-2px' }} />
                    )}
                    {t.title}
                </div>
                {/* Tap-to-cycle status badge. Зона нажатия 44 px, пилюля — внутри. */}
                <button
                    onClick={(e) => { e.stopPropagation(); onAdvanceStatus(); }}
                    aria-label={`Статус: ${statusLabel(t.status)}. Нажмите, чтобы сменить`}
                    style={{
                        background: 'transparent', border: 'none', padding: 0,
                        minWidth: 44, minHeight: 44, margin: '-12px -8px -12px 0',
                        display: 'flex', alignItems: 'center', justifyContent: 'flex-end',
                        cursor: 'pointer', flexShrink: 0, fontFamily: 'inherit',
                    }}
                >
                    <span style={statusPill(t.status)}>
                        <StatusIcon size={12} aria-hidden="true" /> {statusLabel(t.status)}
                    </span>
                </button>
            </div>
            {/* Meta row */}
            <div style={{ display: 'flex', gap: 10, fontSize: 12, color: 'var(--color-ink-60)', marginTop: 8, flexWrap: 'wrap' }}>
                {assigneeName && (
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                        <UserIcon size={12} aria-hidden="true" /> {assigneeName}
                    </span>
                )}
                {dueLabel && (
                    <span style={{
                        display: 'inline-flex', alignItems: 'center', gap: 4,
                        color: overdue ? 'var(--status-danger-fg)' : 'var(--color-ink-60)',
                        fontWeight: overdue ? 600 : 500,
                    }}>
                        <Clock size={12} aria-hidden="true" /> {dueLabel}
                    </span>
                )}
                {overdue && t.status !== 'DONE' && (
                    <span style={{
                        display: 'inline-flex', alignItems: 'center', gap: 4,
                        color: 'var(--status-danger-fg)', fontWeight: 600,
                    }}>
                        <AlertTriangle size={12} aria-hidden="true" /> просрочена
                    </span>
                )}
                {recurrence && (
                    <span style={{
                        display: 'inline-flex', alignItems: 'center', gap: 4,
                        background: 'var(--color-sunken)', color: 'var(--color-ink-80)',
                        fontWeight: 600, padding: '2px 6px', borderRadius: 6,
                    }}>
                        <Repeat size={12} aria-hidden="true" /> {recurrenceLabel(recurrence)}
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
    const { confirm } = useConfirmDialog();

    const setStatus = async (status: TaskStatus) => {
        setBusy(true);
        try {
            const updated = await adminTasksApi.update(task.id, { status });
            onChange(updated);
        } catch { toast.error('Не удалось сменить статус. Попробуйте ещё раз'); } finally { setBusy(false); }
    };
    const setPriority = async (priority: TaskPriority) => {
        setBusy(true);
        try {
            const updated = await adminTasksApi.update(task.id, { priority });
            onChange(updated);
        } catch { toast.error('Не удалось сменить приоритет. Попробуйте ещё раз'); } finally { setBusy(false); }
    };
    const setAssignee = async (uid: string | null, name: string | null) => {
        setBusy(true);
        try {
            const updated = await adminTasksApi.update(task.id, { assigneeId: uid ?? undefined, assigneeName: name ?? undefined });
            onChange(updated);
            setPickAssignee(false);
        } catch { toast.error('Не удалось назначить исполнителя. Попробуйте ещё раз'); } finally { setBusy(false); }
    };
    const setRecurrenceVal = async (rec: Recurrence | null) => {
        setBusy(true);
        try {
            const labels = withRecurrence(task.labels, rec);
            const updated = await adminTasksApi.update(task.id, { labels });
            onChange(updated);
        } catch { toast.error('Не удалось сохранить повтор. Попробуйте ещё раз'); } finally { setBusy(false); }
    };
    const currentRecurrence = getRecurrence(task);
    const remove = async () => {
        const ok = await confirm({
            title: 'Удалить задачу?',
            body: `«${task.title}» удалится у всей команды. Вернуть её не получится.`,
            confirmLabel: 'Удалить задачу',
            cancelLabel: 'Оставить',
            tone: 'danger',
        });
        if (!ok) return;
        setBusy(true);
        try {
            await adminTasksApi.delete(task.id);
            onDelete(task.id);
            onClose();
            toast.success('Задача удалена');
        } catch { toast.error('Не удалось удалить задачу. Попробуйте ещё раз'); } finally { setBusy(false); }
    };

    if (pickAssignee) {
        // Выбор исполнителя — шаг внутри шторки: «Закрыть» возвращает к задаче.
        return (
            <Sheet open onClose={() => setPickAssignee(false)} title="Кому назначить">
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <button
                        onClick={() => setAssignee(null, null)}
                        disabled={busy}
                        aria-pressed={!task.assigneeId}
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
                                aria-pressed={task.assigneeId === u.id}
                                style={pickerListItem(task.assigneeId === u.id)}
                            >
                                <span>{u.name || u.email}</span>
                                {u.role && <span style={{ fontSize: 12, fontWeight: 400 }}>{ROLE_LABEL[u.role] ?? 'Другая роль'}</span>}
                            </button>
                        ))}
                </div>
            </Sheet>
        );
    }

    return (
        <Sheet open onClose={onClose} title={task.title}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                {task.description && (
                    <div style={{ fontSize: 14, color: 'var(--color-ink-80)', whiteSpace: 'pre-wrap', lineHeight: 1.45 }}>
                        {task.description}
                    </div>
                )}

                {/* Status row */}
                <div>
                    <div style={fieldLabel}>Статус</div>
                    <Segmented<TaskStatus>
                        aria-label="Статус"
                        options={(['TODO', 'IN_PROGRESS', 'DONE'] as const).map(s => ({ value: s, label: statusLabel(s), disabled: busy }))}
                        value={task.status}
                        onChange={s => { if (s !== task.status) setStatus(s); }}
                    />
                </div>

                {/* Priority row */}
                <div>
                    <div style={fieldLabel}>Приоритет</div>
                    <Segmented<TaskPriority>
                        aria-label="Приоритет"
                        options={PRIORITY_OPTIONS.map(o => ({ ...o, disabled: busy }))}
                        value={task.priority}
                        onChange={p => { if (p !== task.priority) setPriority(p); }}
                    />
                </div>

                {/* Assignee */}
                <div>
                    <div style={fieldLabel}>Исполнитель</div>
                    <button
                        onClick={() => setPickAssignee(true)}
                        style={{
                            width: '100%',
                            minHeight: 44,
                            background: 'var(--color-card)',
                            border: '1px solid var(--color-ink-20)',
                            borderRadius: 8,
                            padding: '10px 12px',
                            fontSize: 16,
                            fontFamily: 'inherit',
                            color: 'var(--color-ink)',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                        }}
                    >
                        <span>{assigneeName || 'Не назначен'}</span>
                        <ChevronDown size={16} color={COLOR.ink60} aria-hidden="true" />
                    </button>
                </div>

                {/* Recurrence */}
                <div>
                    <div style={fieldLabel}>Повтор</div>
                    <div role="group" aria-label="Повтор" style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        {RECURRENCE_OPTIONS.map(([rec, label]) => (
                            <Chip
                                key={String(rec)}
                                selected={currentRecurrence === rec}
                                disabled={busy}
                                onClick={() => setRecurrenceVal(rec)}
                            >
                                {label}
                            </Chip>
                        ))}
                    </div>
                    {currentRecurrence && (
                        <div style={{ fontSize: 12, color: 'var(--color-ink-60)', marginTop: 6 }}>
                            Когда отметите задачу сделанной, следующая создастся сама — с тем же исполнителем и сдвинутым сроком.
                        </div>
                    )}
                </div>

                {/* Deadline */}
                {task.deadline && (
                    <div>
                        <div style={fieldLabel}>Срок</div>
                        <div style={{ fontSize: 14, color: isOverdue(task) ? 'var(--status-danger-fg)' : 'var(--color-ink)', fontWeight: 600 }}>
                            {formatDateLabel(new Date(task.deadline), { capitalize: true })}
                            {isOverdue(task) && <span style={{ marginLeft: 8 }}>· просрочена</span>}
                        </div>
                    </div>
                )}

                <div style={{ fontSize: 12, color: 'var(--color-ink-60)' }}>
                    Создал: {task.createdByName} · {formatDayMonth(new Date(task.createdAt))}, {formatTime(new Date(task.createdAt))}
                </div>

                {/* Delete */}
                <Button
                    variant="quiet"
                    disabled={busy}
                    icon={<Trash2 size={16} aria-hidden="true" />}
                    onClick={remove}
                    style={{ color: 'var(--status-danger-fg)', alignSelf: 'flex-start', paddingLeft: 0 }}
                >
                    Удалить задачу
                </Button>

                <div style={{ fontSize: 12, color: 'var(--color-ink-60)', borderTop: '1px solid var(--color-ink-08)', paddingTop: 10 }}>
                    Комментарии, чек-листы и файлы удобнее вести на компьютере.
                </div>
            </div>
        </Sheet>
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
    const [priority, setPriority] = useState<TaskPriority>('MEDIUM');
    const [recurrence, setRecurrence] = useState<Recurrence | null>(null);
    const [busy, setBusy] = useState(false);
    // Фокус сразу в поле заголовка (шторка сама ставит фокус на себя).
    const titleRef = useRef<HTMLInputElement>(null);

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
            toast.error('Введите заголовок задачи');
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
                    : 'Не удалось создать задачу. Попробуйте ещё раз';
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
        <Sheet
            open
            onClose={onClose}
            title="Новая задача"
            initialFocus={titleRef}
            footer={
                <Button block loading={busy} disabled={!title.trim()} onClick={submit}>
                    Создать задачу
                </Button>
            }
        >
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <Field label="Заголовок">
                    <Input
                        ref={titleRef}
                        value={title}
                        onChange={e => setTitle(e.target.value)}
                        placeholder="Что нужно сделать?"
                    />
                </Field>

                <Field label="Описание" optional>
                    <TextArea
                        value={description}
                        onChange={e => setDescription(e.target.value)}
                        placeholder="Детали"
                        rows={3}
                    />
                </Field>

                <Field label="Кому">
                    <Select
                        value={assigneeId ?? ''}
                        onChange={e => setAssigneeId(e.target.value || null)}
                    >
                        <option value="">Не назначать</option>
                        {sortedUsers.map(u => (
                            <option key={u.id} value={u.id}>
                                {u.name || u.email}
                                {u.id === currentUser?.id ? ' (мне)' : ''}
                            </option>
                        ))}
                    </Select>
                </Field>

                <div>
                    <div style={fieldLabel}>Срок</div>
                    <div role="group" aria-label="Срок" style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        {([
                            ['none', 'Без срока'],
                            ['today', 'Сегодня'],
                            ['tomorrow', 'Завтра'],
                            ['week', 'Через неделю'],
                        ] as Array<['today' | 'tomorrow' | 'week' | 'none', string]>).map(([id, label]) => (
                            <Chip
                                key={id}
                                selected={deadlinePreset === id}
                                onClick={() => setDeadlinePreset(id)}
                            >
                                {label}
                            </Chip>
                        ))}
                    </div>
                </div>

                <div>
                    <div style={fieldLabel}>Приоритет</div>
                    <Segmented<TaskPriority>
                        aria-label="Приоритет"
                        options={PRIORITY_OPTIONS}
                        value={priority}
                        onChange={setPriority}
                    />
                </div>

                {/* Recurrence — turns the task into a "regular" one. When the
                    new task is marked DONE, the next occurrence is auto-created. */}
                <div>
                    <div style={fieldLabel}>Повтор</div>
                    <div role="group" aria-label="Повтор" style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        {RECURRENCE_OPTIONS.map(([rec, label]) => (
                            <Chip
                                key={String(rec)}
                                selected={recurrence === rec}
                                onClick={() => setRecurrence(rec)}
                            >
                                {label}
                            </Chip>
                        ))}
                    </div>
                    {recurrence && (
                        <div style={{ fontSize: 12, color: 'var(--color-ink-60)', marginTop: 6, lineHeight: 1.4 }}>
                            Когда отметите эту задачу сделанной, следующая создастся сама.
                            Срок сдвинется: {recurrenceLabel(recurrence).toLowerCase()}.
                        </div>
                    )}
                </div>
            </div>
        </Sheet>
    );
}

// ─── helpers ──────────────────────────────────────────────────────
function isOverdue(t: AdminTask): boolean {
    if (t.status === 'DONE') return false;
    if (!t.deadline) return false;
    return new Date(t.deadline).getTime() < Date.now();
}

/** Статусы задач — свой набор (не брони и не сессии), поэтому здесь, а не
 *  в src/design/statuses.ts. */
function statusLabel(s: string): string {
    return s === 'TODO' ? 'Открыта' : s === 'IN_PROGRESS' ? 'В работе' : 'Сделано';
}
function statusIcon(s: string) {
    return s === 'TODO' ? Circle : s === 'IN_PROGRESS' ? CircleDot : CircleCheck;
}

function humanizeDeadline(d: Date): string {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today.getTime() + 86400000);
    const dDay = new Date(d);
    dDay.setHours(0, 0, 0, 0);
    const ms = dDay.getTime() - today.getTime();
    if (ms < 0) return `до ${formatDayMonth(d)}`;
    if (dDay.getTime() === today.getTime()) return 'до сегодня';
    if (dDay.getTime() === tomorrow.getTime()) return 'до завтра';
    if (ms < 7 * 86400000) return `до ${formatDateLabel(d)}`;
    return `до ${formatDayMonth(d)}`;
}

const fieldLabel: React.CSSProperties = {
    fontSize: 14, fontWeight: 600,
    color: 'var(--color-ink)',
    marginBottom: 8,
};

function statusPill(s: string): React.CSSProperties {
    const map: Record<string, { bg: string; fg: string }> = {
        TODO: { bg: 'var(--status-muted-bg)', fg: 'var(--status-muted-fg)' },
        IN_PROGRESS: { bg: 'var(--status-pending-bg)', fg: 'var(--status-pending-fg)' },
        DONE: { bg: 'var(--status-ok-bg)', fg: 'var(--status-ok-fg)' },
    };
    const c = map[s] || map.TODO;
    return {
        background: c.bg,
        color: c.fg,
        borderRadius: 999,
        padding: '4px 10px',
        fontSize: 12,
        fontWeight: 600,
        whiteSpace: 'nowrap',
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
    };
}

function pickerListItem(active: boolean): React.CSSProperties {
    return {
        background: active ? 'var(--color-accent-soft)' : 'var(--color-card)',
        color: 'var(--color-ink)',
        border: active ? '1px solid var(--color-accent)' : '1px solid var(--color-ink-10)',
        borderRadius: 8,
        padding: '12px 14px',
        minHeight: 48,
        fontSize: 16,
        fontWeight: active ? 600 : 500,
        cursor: 'pointer',
        fontFamily: 'inherit',
        textAlign: 'left',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        gap: 10,
    };
}
