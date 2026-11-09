import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X, Sun, Check, ChevronDown } from 'lucide-react';
import { batumiDayKey } from '../../../utils/adminToday';
import { statusLabel } from '../../../design/statuses';

/**
 * Excel #54 variant B — morning checklist as a *soft* reminder, not a
 * blocking gate.
 *
 * Behaviour (владелец 13.10):
 *   - При первом входе в «Финансы» за день (день — по Тбилиси) — окно с
 *     чек-листом смены; на компьютере и на телефоне.
 *   - Больше не показывается сегодня, только когда отмечены ВСЕ пункты
 *     (localStorage `unbox_morning_checklist_<YYYY-MM-DD>_<user>`). Раньше
 *     можно было «Принято, больше не показывать» без единой галочки.
 *   - ✕ / «Позже» — закрыть; при следующем входе в «Финансы» окно вернётся.
 *     Доступ к «Финансам» не перекрывает.
 *
 * Пункты: главное из утреннего чек-листа (База знаний) + денежные правила из
 * разборов чата админов (2020 ₾ вместо 20, цена 0 ₾ без причины, вечерняя
 * сверка по «На сегодня»).
 */

export const CHECKLIST_ITEMS = [
    { key: 'open', label: 'Филиал открыт к первой брони, кабинеты и холл проверены по утреннему чек-листу' },
    { key: 'cash', label: 'Наличные пересчитаны и совпадают с остатком на сайте (не совпадают — написать вчерашнему администратору). Есть размен на 20 и 50 ₾' },
    // Одно слово для срочной брони на всех экранах персонала (ревью 09.11, №14).
    { key: 'requests', label: `Срочные брони «${statusLabel('booking', 'pending_approval', 'staff')}» разобраны — одобрить или отклонить` },
    { key: 'pay', label: '«Принять оплату»: перед записью проверяю клиента и сумму' },
    { key: 'reason', label: 'Цену 0 ₾ и ручную правку баланса — только с причиной' },
    { key: 'evening', label: 'Вечером сверяю с таблицей строку «На сегодня», а не «Баланс» (завтрашние брони уже списаны)' },
];
const ITEMS = CHECKLIST_ITEMS;

function storageKey(userEmail: string): string {
    // День — по Тбилиси (раньше toISOString: день менялся в 04:00 по Тбилиси).
    return `unbox_morning_checklist_${batumiDayKey()}_${userEmail}`;
}

/** Отмеченные за сегодня пункты — общие у окна (компьютер) и карточки «Утро» (телефон). */
function progressKey(userEmail: string): string {
    return `unbox_morning_checklist_progress_${batumiDayKey()}_${userEmail}`;
}

function readProgress(userEmail: string): Record<string, boolean> {
    try {
        const raw = localStorage.getItem(progressKey(userEmail));
        const v = raw ? JSON.parse(raw) : null;
        return v && typeof v === 'object' ? v : {};
    } catch { return {}; }
}

function writeProgress(userEmail: string, v: Record<string, boolean>): void {
    try { localStorage.setItem(progressKey(userEmail), JSON.stringify(v)); } catch { /* ignore */ }
}

function isDoneToday(userEmail: string): boolean {
    try { return !!localStorage.getItem(storageKey(userEmail)); } catch { return false; }
}

function markDoneToday(userEmail: string): void {
    try { localStorage.setItem(storageKey(userEmail), new Date().toISOString()); } catch { /* ignore */ }
}

interface Props {
    /** Current admin email — used to key the per-day seen flag. */
    adminEmail: string;
}

export function MorningChecklistModal({ adminEmail }: Props) {
    const [isOpen, setIsOpen] = useState(false);
    const [checked, setCheckedRaw] = useState<Record<string, boolean>>(() => readProgress(adminEmail));
    const setChecked = (fn: (c: Record<string, boolean>) => Record<string, boolean>) => {
        const next = fn(checked);
        setCheckedRaw(next);
        writeProgress(adminEmail, next);
    };

    useEffect(() => {
        if (!adminEmail) return;
        try {
            const key = storageKey(adminEmail);
            const seen = localStorage.getItem(key);
            if (!seen) setIsOpen(true);
        } catch {
            // localStorage unavailable — fail open, don't show
        }
    }, [adminEmail]);

    if (!isOpen) return null;

    const allDone = ITEMS.every(i => checked[i.key]);

    const markSeen = () => markDoneToday(adminEmail);

    const handleDismiss = () => {
        // "Позже" — don't mark as done, just close for this session. Will
        // show again if admin refreshes the page during the same day.
        setIsOpen(false);
    };

    const handleAcknowledge = () => {
        if (!allDone) return;   // «больше не показывать» — только с галочками
        markSeen();
        setIsOpen(false);
    };

    return createPortal(
        <div
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm"
            onClick={handleDismiss}
        >
            <div
                className="bg-white rounded-2xl w-full max-w-md flex flex-col max-h-[90vh] shadow-xl"
                onClick={e => e.stopPropagation()}
            >
                {/* Header */}
                <div className="flex items-start justify-between p-5 border-b border-gray-100">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-full bg-sunken flex items-center justify-center text-ink-60">
                            <Sun size={20} />
                        </div>
                        <div>
                            <h3 className="font-bold text-lg text-gray-900">Чек-лист смены</h3>
                            <p className="text-xs text-gray-500 mt-0.5">Отметьте все пункты — сегодня окно больше не появится</p>
                        </div>
                    </div>
                    <button
                        onClick={handleDismiss}
                        className="text-ink-60 hover:text-gray-700"
                        title="Позже"
                        aria-label="Закрыть — напомнить позже"
                    >
                        <X size={20} />
                    </button>
                </div>

                {/* Checklist */}
                <div className="flex-1 overflow-y-auto px-5 py-4 space-y-2">
                    {ITEMS.map((item) => {
                        const isDone = !!checked[item.key];
                        return (
                            <button
                                key={item.key}
                                type="button"
                                onClick={() => setChecked(c => ({ ...c, [item.key]: !c[item.key] }))}
                                className={
                                    'w-full flex items-center gap-3 p-3 rounded-xl border text-left transition-all ' +
                                    (isDone
                                        ? 'border-[var(--status-ok-fg)]/30 bg-[var(--status-ok-bg)]'
                                        : 'border-gray-200 bg-white hover:border-gray-300 hover:bg-gray-50')
                                }
                            >
                                <div
                                    className={
                                        'w-5 h-5 rounded-md flex items-center justify-center shrink-0 transition-colors ' +
                                        (isDone ? 'bg-[var(--status-ok-fg)] text-white' : 'border-2 border-gray-300 bg-white')
                                    }
                                >
                                    {isDone && <Check size={14} strokeWidth={3} />}
                                </div>
                                <span className={'text-sm ' + (isDone ? 'text-[var(--status-ok-fg)] font-medium' : 'text-gray-900')}>
                                    {item.label}
                                </span>
                            </button>
                        );
                    })}
                </div>

                {/* Footer */}
                <div className="p-5 border-t border-gray-100 space-y-2">
                    <button
                        onClick={handleAcknowledge}
                        disabled={!allDone}
                        className={
                            'w-full font-semibold py-2.5 rounded-xl transition-all ' +
                            (allDone
                                ? 'bg-unbox-green text-white hover:bg-unbox-dark'
                                : 'bg-unbox-light text-ink-60 cursor-not-allowed')
                        }
                    >
                        {allDone
                            ? 'Всё проверено — начать день'
                            : `Отметьте все пункты (${ITEMS.filter(i => checked[i.key]).length} из ${ITEMS.length})`}
                    </button>
                    <button
                        onClick={handleDismiss}
                        className="w-full text-gray-500 text-xs font-medium py-1.5 hover:text-gray-800"
                    >
                        Позже (покажется снова)
                    </button>
                </div>
            </div>
        </div>,
        document.body,
    );
}

/**
 * Карточка «Утро: 2 из 6» на «Сегодня» в мобильной админке (ревью 09.11, №17).
 *
 * Раньше чек-лист выскакивал окном на весь экран при каждом входе в «Кассу»,
 * пока не отмечены все 6 пунктов, — клиент у стойки ждал, пока админ закроет
 * окно. Теперь это спокойная карточка: по нажатию раскрывается список, галочки
 * сохраняются (общие с окном на компьютере), когда отмечены все — карточка
 * сворачивается в «Утро: всё проверено», и окно на компьютере сегодня тоже не
 * появится.
 */
export function MorningChecklistCard({ adminEmail }: Props) {
    const [checked, setCheckedRaw] = useState<Record<string, boolean>>(() => readProgress(adminEmail));
    const [done, setDone] = useState(() => isDoneToday(adminEmail));
    const [open, setOpen] = useState(false);
    const count = ITEMS.filter(i => checked[i.key]).length;
    const toggle = (key: string) => {
        const next = { ...checked, [key]: !checked[key] };
        setCheckedRaw(next);
        writeProgress(adminEmail, next);
        if (ITEMS.every(i => next[i.key])) {
            markDoneToday(adminEmail);
            setDone(true);
            setOpen(false);
        }
    };
    const allDone = done || count === ITEMS.length;
    return (
        <section data-morning-card aria-label="Чек-лист смены" style={{
            background: 'var(--color-card)', border: '1px solid var(--color-ink-08)', borderRadius: 12,
        }}>
            <button
                type="button"
                onClick={() => setOpen(v => !v)}
                aria-expanded={open}
                className="press"
                style={{
                    width: '100%', minHeight: 48, display: 'flex', alignItems: 'center', gap: 10,
                    padding: '8px 12px', background: 'none', border: 'none', cursor: 'pointer',
                    fontFamily: 'inherit', textAlign: 'left', color: 'var(--color-ink)',
                }}
            >
                <Sun size={18} aria-hidden="true" style={{ color: 'var(--color-ink-60)', flexShrink: 0 }} />
                <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: 'block', fontSize: 14, fontWeight: 600 }}>
                        {allDone ? 'Утро: всё проверено' : <>Утро: <span className="num">{count}</span> из <span className="num">{ITEMS.length}</span></>}
                    </span>
                    {!allDone && (
                        <span style={{ display: 'block', fontSize: 12, color: 'var(--color-ink-60)' }}>
                            Чек-лист смены — нажмите, чтобы отметить
                        </span>
                    )}
                </span>
                <ChevronDown size={18} aria-hidden="true" style={{ color: 'var(--color-ink-60)', transform: open ? 'rotate(180deg)' : undefined }} />
            </button>
            {open && (
                <div style={{ display: 'flex', flexDirection: 'column', borderTop: '1px solid var(--color-ink-08)' }}>
                    {ITEMS.map(item => {
                        const isDone = !!checked[item.key];
                        return (
                            <button
                                key={item.key}
                                type="button"
                                role="checkbox"
                                aria-checked={isDone}
                                onClick={() => toggle(item.key)}
                                style={{
                                    display: 'flex', alignItems: 'flex-start', gap: 10, minHeight: 44,
                                    padding: '10px 12px', background: 'none', border: 'none',
                                    borderBottom: '1px solid var(--color-ink-08)', cursor: 'pointer',
                                    fontFamily: 'inherit', textAlign: 'left',
                                    color: isDone ? 'var(--color-ink-60)' : 'var(--color-ink)', fontSize: 14, lineHeight: 1.4,
                                }}
                            >
                                <span aria-hidden="true" style={{
                                    width: 20, height: 20, borderRadius: 6, flexShrink: 0, marginTop: 1,
                                    display: 'grid', placeItems: 'center',
                                    border: isDone ? 'none' : '2px solid var(--color-ink-20)',
                                    background: isDone ? 'var(--status-ok-fg)' : 'transparent', color: 'var(--color-on-ink)',
                                }}>
                                    {isDone && <Check size={14} strokeWidth={3} />}
                                </span>
                                <span>{item.label}</span>
                            </button>
                        );
                    })}
                </div>
            )}
        </section>
    );
}
