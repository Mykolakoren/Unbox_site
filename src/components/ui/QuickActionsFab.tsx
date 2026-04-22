import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Zap, X } from 'lucide-react';

export interface QuickAction {
    label: string;
    sub?: string;
    /** Internal navigation target. If omitted, use `href` for external links. */
    path?: string;
    /** External URL — opened in a new tab. */
    href?: string;
    /** Icon rendered next to the label. */
    icon?: React.ComponentType<{ size?: number }>;
}

interface Props {
    actions: QuickAction[];
    /** ARIA label for the toggle button. Default: "Быстрые действия". */
    label?: string;
}

/**
 * Floating quick-actions menu anchored to the bottom-right of the viewport.
 * Stays visible on every page of a layout so the user can trigger a key
 * action without scrolling to a dedicated block.
 *
 * Used by:
 *   - Client Dashboard ( Excel #20 )
 *   - CRM Layout       ( Excel #19 )
 */
export function QuickActionsFab({ actions, label = 'Быстрые действия' }: Props) {
    const navigate = useNavigate();
    const [open, setOpen] = useState(false);
    const rootRef = useRef<HTMLDivElement>(null);

    // Close on outside click + ESC
    useEffect(() => {
        if (!open) return;
        const onClick = (e: MouseEvent) => {
            if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
                setOpen(false);
            }
        };
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') setOpen(false);
        };
        document.addEventListener('mousedown', onClick);
        document.addEventListener('keydown', onKey);
        return () => {
            document.removeEventListener('mousedown', onClick);
            document.removeEventListener('keydown', onKey);
        };
    }, [open]);

    if (!actions.length) return null;

    const handle = (a: QuickAction) => {
        setOpen(false);
        if (a.href) {
            window.open(a.href, '_blank', 'noopener,noreferrer');
        } else if (a.path) {
            navigate(a.path);
        }
    };

    return (
        <div
            ref={rootRef}
            className="quick-actions-fab-root"
            style={{
                position: 'fixed',
                right: 20,
                bottom: 20,
                zIndex: 50,
                fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
            }}
        >
            {/* Excel #19/#20 — on desktop we render a visible strip via
                QuickActionsStrip, so the FAB only appears on mobile. */}
            <style>{`
                @media (min-width: 768px) {
                    .quick-actions-fab-root { display: none !important; }
                }
            `}</style>
            {open && (
                <div
                    role="menu"
                    style={{
                        position: 'absolute',
                        right: 0,
                        bottom: 64,
                        width: 280,
                        background: '#fff',
                        border: '1px solid rgba(15,15,16,0.12)',
                        boxShadow: '0 20px 60px rgba(0,0,0,0.18)',
                        overflow: 'hidden',
                        animation: 'qaf-fade 0.14s ease',
                    }}
                >
                    <div
                        style={{
                            padding: '12px 14px',
                            borderBottom: '1px solid rgba(15,15,16,0.08)',
                            fontSize: 11,
                            letterSpacing: '0.18em',
                            textTransform: 'uppercase',
                            color: '#6b7280',
                            fontFamily: '"IBM Plex Mono", ui-monospace, monospace',
                        }}
                    >
                        {label}
                    </div>
                    {actions.map((a, i) => {
                        const Icon = a.icon;
                        return (
                            <button
                                key={(a.path ?? a.href ?? 'a') + i}
                                role="menuitem"
                                onClick={() => handle(a)}
                                style={{
                                    width: '100%',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: 12,
                                    padding: '12px 14px',
                                    background: 'transparent',
                                    border: 'none',
                                    borderBottom:
                                        i < actions.length - 1 ? '1px solid rgba(15,15,16,0.06)' : 'none',
                                    textAlign: 'left',
                                    cursor: 'pointer',
                                    color: '#111',
                                    fontSize: 14,
                                    transition: 'background 0.1s',
                                }}
                                onMouseEnter={(e) => {
                                    (e.currentTarget as HTMLButtonElement).style.background = 'rgba(15,15,16,0.04)';
                                }}
                                onMouseLeave={(e) => {
                                    (e.currentTarget as HTMLButtonElement).style.background = 'transparent';
                                }}
                            >
                                {Icon && (
                                    <span style={{ display: 'inline-flex', color: '#476D6B' }}>
                                        <Icon size={16} />
                                    </span>
                                )}
                                <span style={{ flex: 1, minWidth: 0 }}>
                                    <div style={{ fontWeight: 600, lineHeight: 1.2 }}>{a.label}</div>
                                    {a.sub && (
                                        <div
                                            style={{
                                                fontSize: 12,
                                                color: '#6b7280',
                                                marginTop: 2,
                                                lineHeight: 1.3,
                                            }}
                                        >
                                            {a.sub}
                                        </div>
                                    )}
                                </span>
                            </button>
                        );
                    })}
                </div>
            )}
            <button
                aria-label={label}
                aria-expanded={open}
                onClick={() => setOpen(!open)}
                style={{
                    width: 52,
                    height: 52,
                    borderRadius: '50%',
                    background: open ? '#111' : '#476D6B',
                    color: '#fff',
                    border: 'none',
                    cursor: 'pointer',
                    boxShadow: '0 10px 30px rgba(71,109,107,0.35)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    transition: 'background 0.15s, transform 0.15s',
                    transform: open ? 'rotate(90deg)' : 'none',
                }}
                onMouseEnter={(e) => {
                    (e.currentTarget as HTMLButtonElement).style.background = open ? '#000' : '#3c5b5a';
                }}
                onMouseLeave={(e) => {
                    (e.currentTarget as HTMLButtonElement).style.background = open ? '#111' : '#476D6B';
                }}
            >
                {open ? <X size={22} /> : <Zap size={22} />}
            </button>
        </div>
    );
}
