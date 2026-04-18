import type { ReactNode } from 'react';
import { GH, GH_MONO, GH_SANS } from '../../hooks/useDesignFlag';

interface Props {
    /** Short sentence — what the user is looking at. */
    title: string;
    /** Optional second line — what to do about it. */
    hint?: string;
    /** Optional primary CTA. Omit if there's nothing useful the user can do. */
    action?: { label: string; onClick: () => void };
    /** Optional icon / illustration node (keep it small). */
    icon?: ReactNode;
    /** Tighten vertical padding when used inside a modal or small card. */
    compact?: boolean;
}

/**
 * Reusable empty-state. Use whenever a list or table returns zero rows.
 * Consistent visual language and always ships the "what now?" guidance,
 * so users don't stare at a blank panel wondering if it loaded.
 */
export function EmptyState({ title, hint, action, icon, compact }: Props) {
    return (
        <div
            style={{
                textAlign: 'center',
                padding: compact ? '24px 16px' : '48px 24px',
                fontFamily: GH_SANS,
                color: GH.ink60,
                border: `1px dashed ${GH.ink10}`,
                borderRadius: 12,
                background: GH.paper,
            }}
        >
            {icon && (
                <div style={{ marginBottom: 12, display: 'flex', justifyContent: 'center', color: GH.ink30 }}>
                    {icon}
                </div>
            )}
            <div
                style={{
                    fontFamily: GH_MONO,
                    fontSize: 10,
                    letterSpacing: '0.18em',
                    textTransform: 'uppercase',
                    color: GH.ink30,
                    marginBottom: 8,
                }}
            >
                Пусто
            </div>
            <div style={{ fontSize: 16, fontWeight: 600, color: GH.ink, marginBottom: 6 }}>
                {title}
            </div>
            {hint && (
                <div style={{ fontSize: 14, marginBottom: action ? 16 : 0 }}>
                    {hint}
                </div>
            )}
            {action && (
                <button
                    type="button"
                    onClick={action.onClick}
                    style={{
                        marginTop: 8,
                        padding: '10px 20px',
                        background: GH.ink,
                        color: GH.paper,
                        border: 'none',
                        fontSize: 13,
                        fontWeight: 700,
                        cursor: 'pointer',
                        fontFamily: GH_SANS,
                    }}
                >
                    {action.label}
                </button>
            )}
        </div>
    );
}
