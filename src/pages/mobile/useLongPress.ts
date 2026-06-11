import { useRef } from 'react';

/**
 * Long-press hook for mobile.
 *
 * Returns props you spread on a target element. Fires `onLongPress` after
 * `ms` milliseconds of unbroken touch. A small movement threshold lets the
 * user scroll without triggering — bumping the finger by more than ~10px
 * cancels.
 *
 *   const lp = useLongPress(() => duplicate(b), 600);
 *   <button {...lp}>...</button>
 */
export function useLongPress(onLongPress: () => void, ms = 550) {
    const timer = useRef<number | null>(null);
    const start = useRef<{ x: number; y: number } | null>(null);
    const fired = useRef(false);

    const cancel = () => {
        if (timer.current !== null) {
            window.clearTimeout(timer.current);
            timer.current = null;
        }
        start.current = null;
    };

    return {
        onTouchStart: (e: React.TouchEvent) => {
            const t = e.touches[0];
            start.current = { x: t.clientX, y: t.clientY };
            fired.current = false;
            timer.current = window.setTimeout(() => {
                fired.current = true;
                onLongPress();
                // Haptic feedback if available — feels like a real native
                // long-press, otherwise the visual change is the only signal.
                if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
                    try { navigator.vibrate(40); } catch { /* ignored */ }
                }
            }, ms);
        },
        onTouchMove: (e: React.TouchEvent) => {
            if (!start.current) return;
            const t = e.touches[0];
            const dx = Math.abs(t.clientX - start.current.x);
            const dy = Math.abs(t.clientY - start.current.y);
            if (dx > 10 || dy > 10) cancel();
        },
        onTouchEnd: (e: React.TouchEvent) => {
            cancel();
            // Suppress click after a successful long-press to avoid both
            // long-press handler AND the regular onClick firing.
            if (fired.current) {
                e.preventDefault();
                fired.current = false;
            }
        },
        onTouchCancel: cancel,
        onContextMenu: (e: React.MouseEvent) => {
            // On desktop right-click — also fire long-press for parity.
            e.preventDefault();
            onLongPress();
        },
    };
}
