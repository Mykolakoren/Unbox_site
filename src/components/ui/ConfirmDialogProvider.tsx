import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { Sheet } from './Sheet';
import { Button } from './Button';

/**
 * Окно подтверждения — замена системным confirm() (wave 1, 30.09).
 *
 * Системное окно браузера спрашивает «ОК / Отмена», и непонятно, что значит
 * «ОК» — «да, отменить бронь» или «ок, понял». Здесь кнопки называют
 * действие: «Отменить 6 броней» / «Оставить».
 *
 *   const { confirm } = useConfirmDialog();
 *   const ok = await confirm({
 *       title: 'Отменить серию?',
 *       body: 'Отменим 6 будущих броней, 120 ₾ вернём на баланс.',
 *       confirmLabel: 'Отменить 6 броней',
 *       cancelLabel: 'Оставить',
 *       tone: 'danger',
 *   });
 *   if (ok) { … }
 *
 * Вне React-компонента (стор, утилита) — confirmAction({ … }) с тем же API.
 * После удаления — undoToast('Платёж удалён', restore) с кнопкой «Вернуть»
 * (./undoToast.ts).
 *
 * На телефоне — шторка снизу, на компьютере — окно по центру. Слой dialog —
 * выше любых старых модалок, чтобы подтверждение из них не пряталось.
 * Несколько вызовов подряд встают в очередь, каждый ждёт свой ответ.
 */
export interface ConfirmOptions {
    title: string;
    /** Что именно произойдёт — с числами («вернём 90 ₾ на баланс»). */
    body?: ReactNode;
    /** Кнопка действия — глагол + объект. По умолчанию «Подтвердить». */
    confirmLabel?: string;
    /** Кнопка отказа. По умолчанию «Отмена». */
    cancelLabel?: string;
    /** danger — необратимое: красная кнопка, фокус на «Отмена». */
    tone?: 'default' | 'danger';
    /** @deprecated старое имя body */
    message?: ReactNode;
    /** @deprecated старое имя tone: 'danger' */
    destructive?: boolean;
}

type ConfirmFn = (opts: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<{ confirm: ConfirmFn } | null>(null);

interface Request {
    opts: ConfirmOptions;
    resolve: (v: boolean) => void;
}

interface QueueState {
    queue: Request[];
    /** Что показано в окне. После ответа остаётся прежним, чтобы текст не
     *  пропадал во время анимации ухода. */
    shown?: Request;
}

// Уже отвеченные запросы: двойной тап не «съест» следующий в очереди.
const answered = new WeakSet<Request>();

// Ссылка на смонтированный провайдер — для confirmAction() вне React.
let activeConfirm: ConfirmFn | null = null;

export function ConfirmDialogProvider({ children }: { children: ReactNode }) {
    const [state, setState] = useState<QueueState>({ queue: [] });
    const open = state.queue.length > 0;

    const confirm: ConfirmFn = useCallback((opts) => {
        return new Promise<boolean>((resolve) => {
            const req: Request = { opts, resolve };
            setState(s => ({
                queue: [...s.queue, req],
                // Окно свободно — показываем сразу; иначе ждём своей очереди.
                shown: s.queue.length > 0 ? s.shown : req,
            }));
        });
    }, []);

    useEffect(() => {
        activeConfirm = confirm;
        return () => { if (activeConfirm === confirm) activeConfirm = null; };
    }, [confirm]);

    const shown = state.shown;
    const answer = (value: boolean) => {
        if (!shown || answered.has(shown)) return;
        answered.add(shown);
        shown.resolve(value);
        setState(s => {
            const rest = s.queue.filter(r => r !== shown);
            return { queue: rest, shown: rest[0] ?? shown };
        });
    };

    return (
        <ConfirmContext.Provider value={{ confirm }}>
            {children}
            <ConfirmSheet open={open} request={shown} onAnswer={answer} />
        </ConfirmContext.Provider>
    );
}

function ConfirmSheet({ open, request, onAnswer }: { open: boolean; request?: Request; onAnswer: (v: boolean) => void }) {
    const cancelRef = useRef<HTMLButtonElement>(null);
    const confirmRef = useRef<HTMLButtonElement>(null);
    const opts = request?.opts;
    const danger = opts?.tone === 'danger' || !!opts?.destructive;
    const body = opts?.body ?? opts?.message;

    return (
        <Sheet
            open={open}
            onClose={() => onAnswer(false)}
            title={opts?.title ?? ''}
            layer="dialog"
            role="alertdialog"
            width={420}
            // Необратимое — фокус на безопасной кнопке, Enter не удалит случайно.
            initialFocus={danger ? cancelRef : confirmRef}
            footer={
                <>
                    <Button
                        ref={confirmRef}
                        variant={danger ? 'danger' : 'primary'}
                        block
                        onClick={() => onAnswer(true)}
                    >
                        {opts?.confirmLabel ?? 'Подтвердить'}
                    </Button>
                    <Button ref={cancelRef} variant="secondary" block onClick={() => onAnswer(false)}>
                        {opts?.cancelLabel ?? 'Отмена'}
                    </Button>
                </>
            }
        >
            {body ? <div style={{ color: 'var(--color-ink-80)' }}>{body}</div> : null}
        </Sheet>
    );
}

/** Хук: `{ confirm }`. Бросает, если провайдера нет выше по дереву. */
export function useConfirmDialog() {
    const ctx = useContext(ConfirmContext);
    if (!ctx) {
        throw new Error('useConfirmDialog must be used inside <ConfirmDialogProvider>');
    }
    return ctx;
}

/**
 * То же подтверждение вне компонентов (сторы, утилиты). Провайдер смонтирован
 * в App.tsx. Если его вдруг нет — это ошибка разработки: пишем в консоль и
 * отвечаем «нет», чтобы необратимое действие не прошло без явного согласия.
 */
export function confirmAction(opts: ConfirmOptions): Promise<boolean> {
    if (activeConfirm) return activeConfirm(opts);
    console.error('confirmAction: нет <ConfirmDialogProvider> — действие не подтверждено', opts.title);
    return Promise.resolve(false);
}
