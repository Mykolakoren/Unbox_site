import { useEffect, useRef, useState } from 'react';

type ScrollSource =
    | HTMLElement
    | null
    | React.RefObject<HTMLElement | null>
    | (() => HTMLElement | null);

/**
 * MobileLayout registers its `<main>` scroll container here so every page
 * that calls `usePullToRefresh` gates on the real scroll position without
 * having to thread a ref through `<Outlet/>`. Pages may still override via
 * the `scrollContainer` argument.
 */
let registeredScrollContainer: HTMLElement | null = null;
export function registerPtrScrollContainer(el: HTMLElement | null) {
    registeredScrollContainer = el;
}

/**
 * Pull-to-refresh hook for the mobile cabinet.
 *
 * The real scroll container is MobileLayout's `<main style={{overflow:'auto'}}>`,
 * not the window — so gating on `window.scrollY` fired PTR even when the user
 * was scrolled down inside a list. Pass the scroll container (element, ref, or
 * getter) via `scrollContainer` to gate on its `scrollTop === 0`. When nothing
 * is passed we fall back to the legacy window-top check.
 *
 * Returns:
 *   - distance: current pull offset in px (clamped to 1.5×threshold)
 *   - active: true while a pull is in progress (use to show indicator)
 */
export function usePullToRefresh(
    onRefresh: () => Promise<void> | void,
    threshold = 70,
    scrollContainer?: ScrollSource,
) {
    const startY = useRef<number | null>(null);
    const [distance, setDistance] = useState(0);
    const [active, setActive] = useState(false);

    useEffect(() => {
        const resolveContainer = (): HTMLElement | null => {
            const src = scrollContainer;
            if (!src) return registeredScrollContainer;
            if (typeof src === 'function') return src();
            if (src instanceof HTMLElement) return src;
            return src.current ?? null;
        };

        const atTop = (): boolean => {
            const el = resolveContainer();
            if (el) return el.scrollTop <= 0;
            // Legacy fallback: window/document scrolled to top.
            return window.scrollY === 0
                && (document.documentElement.scrollTop === 0)
                && (document.body.scrollTop === 0);
        };

        const onStart = (e: TouchEvent) => {
            // Only consider when the actual scroll container is at top.
            if (!atTop()) return;
            startY.current = e.touches[0].clientY;
        };
        const onMove = (e: TouchEvent) => {
            if (startY.current === null) return;
            const dy = e.touches[0].clientY - startY.current;
            if (dy <= 0) { setDistance(0); setActive(false); return; }
            // Resistance — slows down past threshold.
            const eased = Math.min(threshold * 1.5, dy * 0.5);
            setDistance(eased);
            setActive(true);
        };
        const onEnd = async () => {
            if (active && distance >= threshold) {
                try { await onRefresh(); } catch { /* swallow */ }
            }
            startY.current = null;
            setDistance(0);
            setActive(false);
        };

        window.addEventListener('touchstart', onStart, { passive: true });
        window.addEventListener('touchmove', onMove, { passive: true });
        window.addEventListener('touchend', onEnd);
        window.addEventListener('touchcancel', onEnd);
        return () => {
            window.removeEventListener('touchstart', onStart);
            window.removeEventListener('touchmove', onMove);
            window.removeEventListener('touchend', onEnd);
            window.removeEventListener('touchcancel', onEnd);
        };
    }, [active, distance, onRefresh, threshold, scrollContainer]);

    return { distance, active, willRefresh: active && distance >= threshold };
}
