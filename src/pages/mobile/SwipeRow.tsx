import { useEffect, useRef, useState } from 'react';

/**
 * Swipe-left action wrapper.
 *
 * Wraps a row's content; on swipe-left exposes one or two action buttons
 * underneath the row's right edge. Releasing past `commitDistance` triggers
 * the primary action; otherwise the row springs back. iOS Mail / WhatsApp
 * pattern — familiar on mobile.
 *
 * Usage:
 *   <SwipeRow primary={{ label: 'Отменить', color: '#C8253A', onAction: ... }}>
 *       <BookingCard ... />
 *   </SwipeRow>
 */
export function SwipeRow({
    children,
    primary,
    secondary,
    disabled,
}: {
    children: React.ReactNode;
    primary: { label: string; color: string; onAction: () => void };
    secondary?: { label: string; color: string; onAction: () => void };
    disabled?: boolean;
}) {
    const ref = useRef<HTMLDivElement>(null);
    const startX = useRef<number | null>(null);
    const startY = useRef<number | null>(null);
    const [dx, setDx] = useState(0);
    const [committing, setCommitting] = useState(false);

    const maxOpen = secondary ? 168 : 96;
    const commitAt = secondary ? 200 : 130;

    useEffect(() => {
        if (disabled) return;
        const node = ref.current;
        if (!node) return;

        const onStart = (e: TouchEvent) => {
            if (e.touches.length !== 1) return;
            startX.current = e.touches[0].clientX;
            startY.current = e.touches[0].clientY;
        };
        const onMove = (e: TouchEvent) => {
            if (startX.current === null || startY.current === null) return;
            const tx = e.touches[0].clientX - startX.current;
            const ty = e.touches[0].clientY - startY.current;
            // Bail if user is mostly scrolling vertically.
            if (Math.abs(ty) > Math.abs(tx)) {
                startX.current = null;
                setDx(0);
                return;
            }
            // Only swipe-left moves the card; to the right we don't go past 0.
            const next = Math.max(-maxOpen * 1.5, Math.min(0, tx));
            setDx(next);
        };
        const onEnd = () => {
            if (startX.current === null) return;
            startX.current = null;
            startY.current = null;
            if (Math.abs(dx) > commitAt) {
                // Past the commit line — fire the primary action and snap back.
                setCommitting(true);
                setDx(0);
                setTimeout(() => setCommitting(false), 200);
                primary.onAction();
            } else if (Math.abs(dx) > maxOpen / 2) {
                // Half-open — snap to fully open so the user can tap action buttons.
                setDx(-maxOpen);
            } else {
                setDx(0);
            }
        };

        node.addEventListener('touchstart', onStart, { passive: true });
        node.addEventListener('touchmove', onMove, { passive: true });
        node.addEventListener('touchend', onEnd);
        node.addEventListener('touchcancel', onEnd);
        return () => {
            node.removeEventListener('touchstart', onStart);
            node.removeEventListener('touchmove', onMove);
            node.removeEventListener('touchend', onEnd);
            node.removeEventListener('touchcancel', onEnd);
        };
    }, [dx, primary, maxOpen, commitAt, disabled]);

    // Tap outside snaps back. Listening on document while open.
    useEffect(() => {
        if (dx === 0) return;
        const onDocTap = (e: MouseEvent | TouchEvent) => {
            if (ref.current && !ref.current.contains(e.target as Node)) {
                setDx(0);
            }
        };
        document.addEventListener('mousedown', onDocTap);
        document.addEventListener('touchstart', onDocTap);
        return () => {
            document.removeEventListener('mousedown', onDocTap);
            document.removeEventListener('touchstart', onDocTap);
        };
    }, [dx]);

    return (
        <div ref={ref} style={{ position: 'relative', overflow: 'hidden', borderRadius: 14, touchAction: 'pan-y' }}>
            {/* Action layer (revealed by swipe) */}
            <div style={{
                position: 'absolute',
                top: 0, right: 0, bottom: 0,
                display: 'flex',
                alignItems: 'stretch',
                gap: 0,
            }}>
                {secondary && (
                    <button
                        onClick={() => { setDx(0); secondary.onAction(); }}
                        style={{
                            background: secondary.color,
                            color: '#fff',
                            border: 'none',
                            padding: '0 18px',
                            fontSize: 13,
                            fontWeight: 700,
                            cursor: 'pointer',
                            fontFamily: 'inherit',
                            opacity: dx < -maxOpen / 2 ? 1 : 0,
                            transition: 'opacity 0.12s',
                        }}
                    >
                        {secondary.label}
                    </button>
                )}
                <button
                    onClick={() => { setDx(0); primary.onAction(); }}
                    style={{
                        background: primary.color,
                        color: '#fff',
                        border: 'none',
                        padding: '0 22px',
                        fontSize: 13,
                        fontWeight: 700,
                        cursor: 'pointer',
                        fontFamily: 'inherit',
                        opacity: dx < -maxOpen / 2 ? 1 : 0,
                        transition: 'opacity 0.12s',
                    }}
                >
                    {primary.label}
                </button>
            </div>

            {/* Foreground content — slides left on swipe */}
            <div
                style={{
                    transform: `translateX(${dx}px)`,
                    transition: startX.current === null ? 'transform 0.18s ease' : 'none',
                    background: '#fff',
                    opacity: committing ? 0.5 : 1,
                }}
            >
                {children}
            </div>
        </div>
    );
}
