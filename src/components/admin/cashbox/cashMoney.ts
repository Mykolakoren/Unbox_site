/**
 * Касса: что считать деньгами (волна 4, пакет C). БЕЗ импортов — сторож
 * guard_wave4_money_desk гоняет этот файл через node.
 *
 * N2. Сервер /cashbox/analytics складывает в «приход/расход по дням», итоги и
 * «расходы по категориям» ВСЕ операции, включая корректировки
 * (payment_method = 'adjustment': недельная скидка, ручная правка баланса
 * клиента). Это записи «для истории» — из кассы ничего не пришло и не ушло;
 * /cashbox/summary и /cashbox/balance их уже не считают. Сервер не меняем
 * (решение по волне 4) — вычитаем корректировки на фронте:
 *
 *   1) берём ответ /cashbox/analytics за период;
 *   2) отдельно тянем ТОЛЬКО корректировки того же периода
 *      (/cashbox/transactions?payment_method=adjustment, те же границы дат);
 *   3) excludeAdjustments() вычитает их из того же дня (ключ дня — первые
 *      10 символов даты операции, ровно как сервер: tx.date.strftime('%Y-%m-%d')),
 *      из итогов и из категории расхода; проценты категорий пересчитываются.
 *
 * Так графики и «Выручка» совпадают с итогами периода из /cashbox/summary.
 */

export const NON_MONEY_METHOD = 'adjustment';

export interface MoneyTxLike {
    type: 'income' | 'expense' | string;
    amount: number | string;
    paymentMethod?: string | null;
    categoryName?: string | null;
    date: string;
}

export interface AnalyticsLike {
    dailyData: { date: string; income: number; expense: number }[];
    categoryBreakdown: { categoryName: string; total: number; percentage: number }[];
    totalIncome: number;
    totalExpense: number;
    currentBalance?: number;
}

/** Корректировка — не деньги (не приход и не расход кассы). */
export function isMoneyTx(tx: { paymentMethod?: string | null }): boolean {
    return tx.paymentMethod !== NON_MONEY_METHOD;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Ключ дня так же, как у сервера: дата операции хранится наивным UTC. */
export function serverDayKey(date: string): string {
    return String(date || '').slice(0, 10);
}

/**
 * Ответ /cashbox/analytics без корректировок. `adjustments` — операции периода;
 * всё, что не adjustment, игнорируется (можно передать весь журнал).
 * Минусов не бывает: если корректировок больше, чем было по дню, — 0.
 */
export function excludeAdjustments<T extends AnalyticsLike>(analytics: T, adjustments: MoneyTxLike[]): T {
    const adj = (adjustments || []).filter(t => t && t.paymentMethod === NON_MONEY_METHOD);
    if (adj.length === 0) return analytics;

    const byDay = new Map<string, { income: number; expense: number }>();
    const byCat = new Map<string, number>();
    let adjIncome = 0;
    let adjExpense = 0;
    for (const t of adj) {
        const amount = Number(t.amount) || 0;
        const key = serverDayKey(t.date);
        const cur = byDay.get(key) || { income: 0, expense: 0 };
        if (t.type === 'income') { cur.income += amount; adjIncome += amount; }
        else {
            cur.expense += amount; adjExpense += amount;
            const cat = t.categoryName || 'Без категории';
            byCat.set(cat, (byCat.get(cat) || 0) + amount);
        }
        byDay.set(key, cur);
    }

    const dailyData = analytics.dailyData
        .map(d => {
            const a = byDay.get(d.date);
            if (!a) return d;
            return { ...d, income: r2(Math.max(0, d.income - a.income)), expense: r2(Math.max(0, d.expense - a.expense)) };
        })
        // День, где были только корректировки, — пустой: не рисуем лишнюю точку.
        .filter(d => d.income > 0 || d.expense > 0 || !byDay.has(d.date));

    const totalExpense = r2(Math.max(0, analytics.totalExpense - adjExpense));
    const cats = analytics.categoryBreakdown
        .map(c => ({ ...c, total: r2(Math.max(0, c.total - (byCat.get(c.categoryName) || 0))) }))
        .filter(c => c.total > 0)
        .sort((a, b) => b.total - a.total)
        .map(c => ({ ...c, percentage: totalExpense > 0 ? Math.round((c.total / totalExpense) * 1000) / 10 : 0 }));

    return {
        ...analytics,
        dailyData,
        categoryBreakdown: cats,
        totalIncome: r2(Math.max(0, analytics.totalIncome - adjIncome)),
        totalExpense,
    };
}

/**
 * В5 — можно ли сразу после записи предложить «Вернуть» (удалить операцию).
 * Зеркало сервера DELETE /cashbox/transactions/{id} (transactions.py):
 * owner и senior_admin удаляют любую операцию; остальные — только операцию
 * с датой «сегодня» по часам сервера (UTC; дата операции хранится наивным UTC).
 * Задним числом записанную операцию админ удалить не может — «Вернуть» не
 * показываем, чтобы не обещать то, что сервер отклонит.
 */
export function canUndoCashTx(role: string | null | undefined, txDate: string, now: Date = new Date()): boolean {
    if (role === 'owner' || role === 'senior_admin') return true;
    const utcToday = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-${String(now.getUTCDate()).padStart(2, '0')}`;
    return serverDayKey(txDate) === utcToday;
}

/**
 * В5 — «Вернуть» по одной операции срабатывает один раз (доработка волны 4).
 * Двойной тап по кнопке в тосте успевал отправить два DELETE подряд: второй
 * падал 404 и пугал админа ошибкой, хотя операция уже удалена. Флаг «уже
 * нажато» — по id операции, на уровне модуля: тост живёт дольше окна, которое
 * его показало (окно закрывается сразу после записи).
 *
 *   if (!claimCashUndo(id)) return;      // второй вызов ничего не делает
 *   try { await deleteTransaction(id) } catch { releaseCashUndo(id) }
 *
 * При ошибке флаг снимаем — повторить можно (например, из журнала).
 */
const cashUndoClaimed = new Set<string>();

export function claimCashUndo(id: string): boolean {
    if (!id || cashUndoClaimed.has(id)) return false;
    cashUndoClaimed.add(id);
    return true;
}

export function releaseCashUndo(id: string): void {
    cashUndoClaimed.delete(id);
}
