import {
    useEffect, useId, useRef, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent,
    type PointerEvent as ReactPointerEvent, type ReactNode, type RefObject,
} from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion, useDragControls, useIsPresent, type PanInfo } from 'framer-motion';
import { X } from 'lucide-react';
import clsx from 'clsx';
import { useIsDesktop } from '../../hooks/useMediaQuery';
import { useScrollLock } from '../../hooks/useScrollLock';
import { MOTION, Z } from '../../design/tokens';

/**
 * Sheet — общая шторка / окно (wave 1, 30.09).
 *
 * На телефоне — шторка снизу, на компьютере — окно по центру (mode="auto").
 * Что уже встроено, чтобы каждый экран не делал это заново:
 *  - портал в body на слое --z-sheet, то есть ВЫШЕ нижнего меню /m;
 *  - высота ограничена экраном, тело прокручивается внутри, а подвал
 *    с главной кнопкой (footer) всегда виден и учитывает вырез iPhone;
 *  - Esc и системная «Назад» на Android закрывают (только верхнюю шторку,
 *    если их две), фокус заперт
 *    внутри и возвращается на кнопку, которая открыла шторку;
 *  - свайп вниз за ручку/шапку закрывает (быстрый рывок — тоже);
 *  - фон не прокручивается под шторкой (общий ref-counted лок);
 *  - появление 220 мс, уход 180 мс; при «уменьшить движение» — без сдвигов.
 *
 *   <Sheet open={open} onClose={() => setOpen(false)} title="Пополнить баланс"
 *          footer={<Button block onClick={save}>Пополнить на 20 ₾</Button>}>
 *     …поля…
 *   </Sheet>
 */
export interface SheetProps {
    open: boolean;
    onClose: () => void;
    /** Заголовок обязателен — по нему экранный диктор называет окно. */
    title: ReactNode;
    description?: ReactNode;
    /** Небольшое действие в шапке рядом с крестиком (например, «Прочитать все»). */
    headerAction?: ReactNode;
    children?: ReactNode;
    /** Подвал с действиями. Первой ставьте главную кнопку. */
    footer?: ReactNode;
    /** auto — снизу на телефоне, по центру на компьютере. */
    mode?: 'auto' | 'bottom' | 'center';
    /** dialog — слой подтверждений (выше старых модалок). По умолчанию sheet. */
    layer?: 'sheet' | 'dialog';
    /** Ширина окна на компьютере, px. */
    width?: number;
    /** false — нельзя закрыть Esc/фоном/свайпом (например, идёт оплата). */
    dismissible?: boolean;
    /** Куда поставить фокус при открытии. По умолчанию — на саму шторку
     *  (чтобы на телефоне не выскакивала клавиатура). */
    initialFocus?: RefObject<HTMLElement | null>;
    role?: 'dialog' | 'alertdialog';
    className?: string;
}

export function Sheet(props: SheetProps) {
    if (typeof document === 'undefined') return null;
    return createPortal(
        <AnimatePresence>
            {props.open && <SheetPanel key="ui-sheet" {...props} />}
        </AnimatePresence>,
        document.body,
    );
}

// Стек открытых шторок: Esc и фокус-ловушка работают только у верхней.
const openStack: string[] = [];

const FOCUSABLE = [
    'a[href]', 'button:not([disabled])', 'input:not([disabled]):not([type="hidden"])',
    'select:not([disabled])', 'textarea:not([disabled])', '[tabindex]:not([tabindex="-1"])',
].join(',');

function SheetPanel({
    onClose, title, description, headerAction, children, footer,
    mode = 'auto', layer = 'sheet', width, dismissible = true,
    initialFocus, role = 'dialog', className,
}: SheetProps) {
    const isDesktop = useIsDesktop();
    const resolved: 'bottom' | 'center' = mode === 'auto' ? (isDesktop ? 'center' : 'bottom') : mode;
    const id = useId();
    const titleId = `${id}-title`;
    const descId = `${id}-desc`;
    const panelRef = useRef<HTMLDivElement>(null);
    const dragControls = useDragControls();
    const onCloseRef = useRef(onClose);
    onCloseRef.current = onClose;
    const dismissibleRef = useRef(dismissible);
    dismissibleRef.current = dismissible;
    // Пока шторка уезжает (180 мс), «Назад» не должна закрывать её второй раз.
    const isPresent = useIsPresent();
    const presentRef = useRef(isPresent);
    presentRef.current = isPresent;
    // Сторож системной «Назад» (CloseWatcher). Снимаем его, как только шторка
    // начала уезжать: иначе «Назад» в эти 180 мс молча съедалась бы.
    const watcherRef = useRef<{ onclose: (() => void) | null; destroy: () => void } | null>(null);
    const disarmWatcher = () => {
        const w = watcherRef.current;
        if (!w) return;
        watcherRef.current = null;
        w.onclose = null;
        try { w.destroy(); } catch { /* уже закрыт */ }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    useEffect(() => { if (!isPresent) disarmWatcher(); }, [isPresent]);

    useScrollLock();

    // Стек + Esc + возврат фокуса туда, откуда открыли.
    useEffect(() => {
        const opener = document.activeElement as HTMLElement | null;
        openStack.push(id);
        const onKey = (e: KeyboardEvent) => {
            if (e.key !== 'Escape' || openStack[openStack.length - 1] !== id) return;
            if (!dismissibleRef.current) return;
            e.stopPropagation();
            // preventDefault — чтобы «сторож закрытия» ниже не закрыл шторку второй раз.
            e.preventDefault();
            onCloseRef.current();
        };
        document.addEventListener('keydown', onKey);
        // Системная «Назад» на Android (28.11, шаг 1 плана мобильной брони): раньше
        // она уводила со страницы, а шторка оставалась висеть над чужим экраном.
        // CloseWatcher (Chrome/Edge/Samsung на Android) отдаёт «Назад» верхней
        // шторке — без записей в истории браузера, поэтому маршруты не трогаем.
        // Где его нет (iPhone, Firefox) — всё как раньше.
        type Watcher = { onclose: (() => void) | null; destroy: () => void };
        const WatcherCtor = (window as unknown as { CloseWatcher?: new () => Watcher }).CloseWatcher;
        let mounted = true;
        const arm = () => {
            if (!WatcherCtor || !mounted) return;
            try {
                const w = new WatcherCtor();
                w.onclose = () => {
                    watcherRef.current = null;
                    if (!presentRef.current) return;          // шторка уже уезжает
                    // Браузер отдаёт «Назад» последнему созданному сторожу, а не верхней
                    // шторке; а сторожей, созданных без касания, закрывает пачкой. Поэтому
                    // закрываемся, только если мы верхние и закрывать можно; иначе
                    // остаёмся и ждём следующую «Назад».
                    if (openStack[openStack.length - 1] === id && dismissibleRef.current) {
                        onCloseRef.current();
                        // onClose мог не закрыть шторку («Закрыть без сохранения?» →
                        // «Вернуться», идёт сохранение): тогда сторожим дальше, иначе
                        // следующая «Назад» увела бы со страницы вместе с формой.
                        setTimeout(() => { if (mounted && presentRef.current && !watcherRef.current) arm(); }, 60);
                        return;
                    }
                    arm();
                };
                watcherRef.current = w;
            } catch { watcherRef.current = null; }
        };
        // Взводим всегда, даже у «незакрываемой» шторки: пока идёт оплата, «Назад»
        // не должна ни закрыть шторку под ней, ни увести со страницы.
        arm();
        // Фокус внутрь после первого кадра (панель уже в DOM).
        const raf = requestAnimationFrame(() => {
            const target = initialFocus?.current ?? panelRef.current;
            target?.focus({ preventScroll: true });
        });
        return () => {
            mounted = false;
            cancelAnimationFrame(raf);
            document.removeEventListener('keydown', onKey);
            disarmWatcher();
            const i = openStack.lastIndexOf(id);
            if (i !== -1) openStack.splice(i, 1);
            if (opener && document.contains(opener)) opener.focus({ preventScroll: true });
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [id]);

    // Фокус-ловушка: Tab / Shift+Tab не уходят за пределы шторки.
    const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
        if (e.key !== 'Tab' || !panelRef.current) return;
        const nodes = Array.from(panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE))
            .filter(n => n.offsetParent !== null || n === document.activeElement);
        if (nodes.length === 0) { e.preventDefault(); panelRef.current.focus(); return; }
        const first = nodes[0];
        const last = nodes[nodes.length - 1];
        const active = document.activeElement;
        if (e.shiftKey && (active === first || active === panelRef.current)) {
            e.preventDefault(); last.focus();
        } else if (!e.shiftKey && active === last) {
            e.preventDefault(); first.focus();
        }
    };

    // Свайп вниз начинается только с ручки/шапки: в теле свой скролл.
    const startDrag = (e: ReactPointerEvent<HTMLDivElement>) => {
        if (resolved !== 'bottom' || !dismissible) return;
        if ((e.target as HTMLElement).closest('button, a, input, select, textarea')) return;
        dragControls.start(e);
    };
    const onDragEnd = (_: unknown, info: PanInfo) => {
        if (info.offset.y > 120 || info.velocity.y > 500) onClose();
    };

    const zBackdrop = layer === 'dialog' ? Z.dialog - 1 : Z.sheetBackdrop;
    const zPanel = layer === 'dialog' ? Z.dialog : Z.sheet;
    const inDur = MOTION.sheetIn / 1000;
    const outDur = MOTION.sheetOut / 1000;

    const panelAnim = resolved === 'bottom'
        ? {
            initial: { y: '100%' },
            animate: { y: 0, transition: { duration: inDur, ease: MOTION.easeDrawer } },
            exit: { y: '100%', transition: { duration: outDur, ease: MOTION.easeOut } },
        }
        : {
            initial: { opacity: 0, scale: 0.96 },
            animate: { opacity: 1, scale: 1, transition: { duration: inDur, ease: MOTION.easeOut } },
            exit: { opacity: 0, scale: 0.98, transition: { duration: outDur, ease: MOTION.easeOut } },
        };

    return (
        <>
            <motion.div
                className="ui-sheet-backdrop"
                style={{ zIndex: zBackdrop }}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1, transition: { duration: inDur } }}
                exit={{ opacity: 0, transition: { duration: outDur } }}
                onClick={() => { if (dismissible) onClose(); }}
                aria-hidden="true"
            />
            <div className={`ui-sheet-layer ui-sheet-layer--${resolved}`} style={{ zIndex: zPanel }}>
                <motion.div
                    ref={panelRef}
                    role={role}
                    aria-modal="true"
                    aria-labelledby={titleId}
                    aria-describedby={description ? descId : undefined}
                    tabIndex={-1}
                    data-sheet={resolved}
                    className={clsx('ui-sheet', `ui-sheet--${resolved}`, className)}
                    style={width ? ({ '--sheet-w': `${width}px` } as CSSProperties) : undefined}
                    onKeyDown={onKeyDown}
                    drag={resolved === 'bottom' && dismissible ? 'y' : false}
                    dragListener={false}
                    dragControls={dragControls}
                    dragConstraints={{ top: 0, bottom: 0 }}
                    dragElastic={{ top: 0, bottom: 1 }}
                    dragMomentum={false}
                    onDragEnd={onDragEnd}
                    {...panelAnim}
                >
                    <div className="ui-sheet__grab" onPointerDown={startDrag}>
                        {resolved === 'bottom' && <div className="ui-sheet__handle" aria-hidden="true" />}
                        <div className="ui-sheet__header">
                            <div className="ui-sheet__heading">
                                <h2 id={titleId} className="ui-sheet__title">{title}</h2>
                                {description && <p id={descId} className="ui-sheet__desc">{description}</p>}
                            </div>
                            {headerAction && <div className="ui-sheet__action">{headerAction}</div>}
                            {dismissible && (
                                <button type="button" className="ui-sheet__close" onClick={onClose} aria-label="Закрыть">
                                    <X size={20} aria-hidden="true" />
                                </button>
                            )}
                        </div>
                    </div>
                    {children !== undefined && children !== null && (
                        <div className="ui-sheet__body">{children}</div>
                    )}
                    {footer && <div className="ui-sheet__footer">{footer}</div>}
                </motion.div>
            </div>
        </>
    );
}
