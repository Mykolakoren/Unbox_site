import type { AdminTask } from '../../../api/adminTasks';

/**
 * Recurrence is encoded as a magic label `regular:<period>` on the task's
 * `labels[]` array. This avoids a backend schema migration — the existing
 * AdminTask model already carries free-form labels.
 *
 * When a recurring task is marked DONE, the frontend creates the next
 * occurrence with a shifted deadline (see `nextDeadline`). The original
 * task stays "Done" as a record that the iteration was completed.
 *
 * Periods supported: daily / weekly / biweekly / monthly. Anything else
 * is treated as no-recurrence.
 */
export type Recurrence = 'daily' | 'weekly' | 'biweekly' | 'monthly';

const PREFIX = 'regular:';

export function getRecurrence(task: Pick<AdminTask, 'labels'>): Recurrence | null {
    const labels = task.labels || [];
    for (const l of labels) {
        if (typeof l === 'string' && l.startsWith(PREFIX)) {
            const v = l.slice(PREFIX.length);
            if (v === 'daily' || v === 'weekly' || v === 'biweekly' || v === 'monthly') return v;
        }
    }
    return null;
}

export function withRecurrence(labels: string[] | undefined, recurrence: Recurrence | null): string[] {
    const cleaned = (labels || []).filter(l => !(typeof l === 'string' && l.startsWith(PREFIX)));
    return recurrence ? [...cleaned, `${PREFIX}${recurrence}`] : cleaned;
}

export function recurrenceLabel(r: Recurrence): string {
    return r === 'daily' ? 'Ежедневно'
        : r === 'weekly' ? 'Еженедельно'
        : r === 'biweekly' ? 'Раз в 2 недели'
        : 'Ежемесячно';
}

/** Compute the next deadline given the previous one and a period. */
export function nextDeadline(prev: Date | null, recurrence: Recurrence): Date {
    const base = prev ? new Date(prev) : new Date();
    if (recurrence === 'daily') base.setDate(base.getDate() + 1);
    else if (recurrence === 'weekly') base.setDate(base.getDate() + 7);
    else if (recurrence === 'biweekly') base.setDate(base.getDate() + 14);
    else if (recurrence === 'monthly') base.setMonth(base.getMonth() + 1);
    return base;
}
