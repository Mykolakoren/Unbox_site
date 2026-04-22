import { useNavigate } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { GH, GH_SANS, GH_MONO } from '../../hooks/useDesignFlag';
import type { QuickAction } from './QuickActionsFab';

interface Props {
    actions: QuickAction[];
    /** Shown above the strip as a tiny caps label. Default: "Быстрые действия". */
    heading?: string;
    /** Hide on widths < breakpoint px — mobile uses QuickActionsFab instead. Default: 768. */
    mobileHiddenBelow?: number;
}

/**
 * Horizontal row of quick-action cards — desktop counterpart to
 * QuickActionsFab. Excel #19 / #20: admins wanted a non-sticky visible
 * "quick actions" area on CRM / dashboard overview instead of hunting
 * through the menu.
 *
 * Decision (from feedback): use a strip on desktop + FAB on mobile
 * (instead of a sticky right-hand panel, which breaks Grid House's
 * minimal layout).
 *
 * Each card is a button that navigates via `path` or opens `href` in a
 * new tab. Style matches Grid House hairline + mono labels.
 */
export function QuickActionsStrip({
    actions,
    heading = 'Быстрые действия',
    mobileHiddenBelow = 768,
}: Props) {
    const navigate = useNavigate();
    if (!actions.length) return null;

    const handle = (a: QuickAction) => {
        if (a.href) {
            window.open(a.href, '_blank', 'noopener,noreferrer');
        } else if (a.path) {
            navigate(a.path);
        }
    };

    // Inline media-query style: the parent is a plain div, so we use a CSS
    // class defined locally. Simpler than a resize listener.
    const wrapperStyle: React.CSSProperties = {
        fontFamily: GH_SANS,
        marginBottom: 24,
    };

    return (
        <div className={`quick-actions-strip-root`} style={wrapperStyle}>
            <style>{`
                @media (max-width: ${mobileHiddenBelow - 1}px) {
                    .quick-actions-strip-root { display: none; }
                }
            `}</style>

            <div style={{
                fontFamily: GH_MONO, fontSize: 10, letterSpacing: '0.18em',
                textTransform: 'uppercase', color: GH.ink60, marginBottom: 10,
            }}>
                {heading}
            </div>

            <div style={{
                display: 'grid',
                gridTemplateColumns: `repeat(auto-fit, minmax(240px, 1fr))`,
                gap: 12,
            }}>
                {actions.map((a, i) => {
                    const Icon = a.icon;
                    return (
                        <button
                            key={(a.path ?? a.href ?? 'a') + i}
                            onClick={() => handle(a)}
                            style={{
                                textAlign: 'left',
                                padding: '14px 16px',
                                background: GH.paper,
                                border: `1px solid ${GH.ink10}`,
                                cursor: 'pointer',
                                display: 'flex',
                                alignItems: 'center',
                                gap: 12,
                                transition: 'border-color 0.15s, transform 0.15s, box-shadow 0.15s',
                                fontFamily: GH_SANS,
                            }}
                            onMouseEnter={(e) => {
                                (e.currentTarget as HTMLButtonElement).style.borderColor = GH.ink;
                                (e.currentTarget as HTMLButtonElement).style.boxShadow = `4px 4px 0 ${GH.ink10}`;
                            }}
                            onMouseLeave={(e) => {
                                (e.currentTarget as HTMLButtonElement).style.borderColor = GH.ink10;
                                (e.currentTarget as HTMLButtonElement).style.boxShadow = 'none';
                            }}
                        >
                            {Icon && (
                                <span style={{
                                    display: 'inline-flex', color: GH.accent,
                                    width: 36, height: 36, borderRadius: '50%',
                                    background: GH.ink5,
                                    alignItems: 'center', justifyContent: 'center',
                                    flexShrink: 0,
                                }}>
                                    <Icon size={18} />
                                </span>
                            )}
                            <span style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ fontSize: 14, fontWeight: 600, color: GH.ink, lineHeight: 1.25 }}>
                                    {a.label}
                                </div>
                                {a.sub && (
                                    <div style={{ fontSize: 12, color: GH.ink60, marginTop: 2, lineHeight: 1.3 }}>
                                        {a.sub}
                                    </div>
                                )}
                            </span>
                            <ArrowRight size={16} style={{ color: GH.ink30, flexShrink: 0 }} />
                        </button>
                    );
                })}
            </div>
        </div>
    );
}
