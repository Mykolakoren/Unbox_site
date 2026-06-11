import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, X } from 'lucide-react';

/**
 * Imperative confirm dialog — drop-in replacement for the native `confirm()`.
 *
 * Why this exists: across the codebase admins hit a confusing mix of
 * native browser confirms (ugly on iOS), inline modals (require local state),
 * and sonner toasts with action buttons (easy to miss). One dialog, called
 * via a hook returning a Promise, eliminates all three:
 *
 *   const { confirm } = useConfirmDialog();
 *   if (await confirm({ title: 'Удалить?', message: 'Это необратимо.' })) {
 *       await api.delete(...);
 *   }
 *
 * Mounted ONCE at the app root via <ConfirmDialogProvider>. Multiple
 * sequential confirms queue naturally because each call awaits its own
 * Promise — a second call while one is open just gets the next dialog
 * after the first closes.
 */
interface ConfirmOptions {
    title: string;
    message?: ReactNode;
    /** Primary CTA label. Default: 'Подтвердить'. */
    confirmLabel?: string;
    /** Secondary label. Default: 'Отмена'. */
    cancelLabel?: string;
    /** Marks the action as destructive — red primary button, warning icon. */
    destructive?: boolean;
}

type ConfirmFn = (opts: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<{ confirm: ConfirmFn } | null>(null);

interface State {
    open: boolean;
    opts: ConfirmOptions;
    resolve: ((v: boolean) => void) | null;
}

const initial: State = {
    open: false,
    opts: { title: '' },
    resolve: null,
};

export function ConfirmDialogProvider({ children }: { children: ReactNode }) {
    const [state, setState] = useState<State>(initial);

    const confirm: ConfirmFn = useCallback((opts) => {
        return new Promise<boolean>((resolve) => {
            setState({ open: true, opts, resolve });
        });
    }, []);

    const close = useCallback((value: boolean) => {
        setState((s) => {
            s.resolve?.(value);
            return { ...s, open: false, resolve: null };
        });
    }, []);

    return (
        <ConfirmContext.Provider value={{ confirm }}>
            {children}
            {state.open && createPortal(
                <ConfirmDialogShell
                    title={state.opts.title}
                    message={state.opts.message}
                    confirmLabel={state.opts.confirmLabel ?? 'Подтвердить'}
                    cancelLabel={state.opts.cancelLabel ?? 'Отмена'}
                    destructive={state.opts.destructive ?? false}
                    onCancel={() => close(false)}
                    onConfirm={() => close(true)}
                />,
                document.body,
            )}
        </ConfirmContext.Provider>
    );
}

/** Hook: returns `{ confirm }`. Throws if used outside the provider. */
export function useConfirmDialog() {
    const ctx = useContext(ConfirmContext);
    if (!ctx) {
        throw new Error('useConfirmDialog must be used inside <ConfirmDialogProvider>');
    }
    return ctx;
}

function ConfirmDialogShell({
    title, message, confirmLabel, cancelLabel, destructive, onCancel, onConfirm,
}: {
    title: string;
    message?: ReactNode;
    confirmLabel: string;
    cancelLabel: string;
    destructive: boolean;
    onCancel: () => void;
    onConfirm: () => void;
}) {
    return (
        <div
            style={{
                position: 'fixed',
                inset: 0,
                zIndex: 9999,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: 'rgba(0,0,0,0.5)',
                backdropFilter: 'blur(4px)',
                WebkitBackdropFilter: 'blur(4px)',
                padding: 16,
                animation: 'confirm-fade-in 160ms ease-out',
            }}
            onClick={onCancel}
        >
            <div
                onClick={(e) => e.stopPropagation()}
                style={{
                    background: '#fff',
                    borderRadius: 16,
                    boxShadow: '0 20px 50px rgba(0,0,0,0.25)',
                    width: '100%',
                    maxWidth: 380,
                    padding: 24,
                    position: 'relative',
                    animation: 'confirm-zoom-in 160ms ease-out',
                    fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
                    color: '#0E0E0E',
                }}
                role="dialog"
                aria-modal="true"
                aria-labelledby="confirm-title"
            >
                <button
                    onClick={onCancel}
                    aria-label="Закрыть"
                    style={{
                        position: 'absolute',
                        top: 14, right: 14,
                        background: 'none', border: 'none',
                        cursor: 'pointer', color: '#888',
                        padding: 4,
                    }}
                >
                    <X size={18} />
                </button>

                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center' }}>
                    <div style={{
                        width: 44, height: 44, borderRadius: 12,
                        background: destructive ? 'rgba(179,38,30,0.10)' : 'rgba(76,138,107,0.10)',
                        color: destructive ? '#B3261E' : '#1B7430',
                        display: 'grid', placeItems: 'center',
                        marginBottom: 14,
                    }}>
                        <AlertTriangle size={22} />
                    </div>
                    <h3 id="confirm-title" style={{
                        fontSize: 17, fontWeight: 700,
                        margin: '0 0 6px', lineHeight: 1.3,
                    }}>
                        {title}
                    </h3>
                    {message && (
                        <div style={{
                            color: '#555',
                            fontSize: 13,
                            lineHeight: 1.5,
                            marginBottom: 18,
                        }}>
                            {message}
                        </div>
                    )}
                </div>

                <div style={{ display: 'flex', gap: 8, marginTop: message ? 0 : 12 }}>
                    <button
                        onClick={onCancel}
                        style={{
                            flex: 1,
                            padding: '11px 0',
                            background: 'rgba(0,0,0,0.04)',
                            color: '#0E0E0E',
                            border: 'none',
                            borderRadius: 10,
                            fontSize: 14,
                            fontWeight: 600,
                            cursor: 'pointer',
                            fontFamily: 'inherit',
                        }}
                        autoFocus={!destructive}
                    >
                        {cancelLabel}
                    </button>
                    <button
                        onClick={onConfirm}
                        style={{
                            flex: 1,
                            padding: '11px 0',
                            background: destructive ? '#B3261E' : '#0E0E0E',
                            color: '#fff',
                            border: 'none',
                            borderRadius: 10,
                            fontSize: 14,
                            fontWeight: 700,
                            cursor: 'pointer',
                            fontFamily: 'inherit',
                        }}
                        autoFocus={destructive}
                    >
                        {confirmLabel}
                    </button>
                </div>
            </div>

            <style>{`
                @keyframes confirm-fade-in {
                    from { opacity: 0; }
                    to { opacity: 1; }
                }
                @keyframes confirm-zoom-in {
                    from { transform: scale(0.95); opacity: 0; }
                    to { transform: scale(1); opacity: 1; }
                }
            `}</style>
        </div>
    );
}
