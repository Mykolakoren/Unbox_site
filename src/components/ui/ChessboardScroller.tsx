import { useRef, useState, useEffect, useCallback } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

interface Props {
    children: React.ReactNode;
    /** Minimum total width of the grid content. Used to decide whether the
     *  scroll buttons are actually useful (no point showing them when
     *  everything fits). */
    minGridWidth?: number;
    /** How many pixels one click shifts the viewport. Defaults to ~4 slots. */
    stepPx?: number;
    className?: string;
}

/**
 * Horizontal scroll wrapper for the chessboard grids (admin, wizard, CRM).
 *
 * What this solves — Excel #9, real user report:
 *   "На узких экранах влезает только до 16:00; хочется взять ползунок и
 *    пролистать до 21:00, но скроллбар еле виден и двигать неудобно."
 *
 * What we give the user:
 *   1. Always-visible themed scrollbar (the .scrollbar-visible CSS in
 *      index.css keeps the macOS thumb from hiding).
 *   2. Two floating chevron buttons on the left/right edges that scroll
 *      by ~4 slots per click. Only shown when the content is wider than
 *      the viewport AND there's still content to scroll toward — no
 *      pointless buttons on huge screens.
 *   3. Mouse wheel shift support: hold Shift and scroll vertically →
 *      horizontal scroll. (Native browser behaviour, we don't need code
 *      for this, but keeping the wheel handler for two-finger horizontal
 *      scroll on mac trackpads.)
 *   4. Keyboard: ← → when focused on the scroll region.
 *
 * We deliberately do NOT enable click-and-drag to pan, because the
 * chessboard itself uses mouse-drag to create/resize bookings; a second
 * drag handler would fight with it and create booking-resize bugs.
 */
export function ChessboardScroller({
    children,
    minGridWidth,
    stepPx = 176,  // ~4 × 44px slot columns
    className = '',
}: Props) {
    const scrollRef = useRef<HTMLDivElement>(null);
    const [canScrollLeft, setCanScrollLeft] = useState(false);
    const [canScrollRight, setCanScrollRight] = useState(false);

    const updateScrollState = useCallback(() => {
        const el = scrollRef.current;
        if (!el) return;
        const overflowing = el.scrollWidth - el.clientWidth > 1;
        setCanScrollLeft(overflowing && el.scrollLeft > 0);
        setCanScrollRight(overflowing && el.scrollLeft + el.clientWidth < el.scrollWidth - 1);
    }, []);

    useEffect(() => {
        updateScrollState();
        const el = scrollRef.current;
        if (!el) return;
        el.addEventListener('scroll', updateScrollState, { passive: true });
        const ro = new ResizeObserver(updateScrollState);
        ro.observe(el);
        return () => {
            el.removeEventListener('scroll', updateScrollState);
            ro.disconnect();
        };
    }, [updateScrollState, minGridWidth]);

    const scrollBy = (delta: number) => {
        scrollRef.current?.scrollBy({ left: delta, behavior: 'smooth' });
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'ArrowRight') {
            e.preventDefault();
            scrollBy(stepPx);
        } else if (e.key === 'ArrowLeft') {
            e.preventDefault();
            scrollBy(-stepPx);
        }
    };

    return (
        <div className={`relative ${className}`}>
            {/* Left button */}
            {canScrollLeft && (
                <button
                    type="button"
                    onClick={() => scrollBy(-stepPx)}
                    aria-label="Прокрутить влево"
                    className="absolute left-2 top-1/2 -translate-y-1/2 z-20 w-9 h-9 rounded-full bg-white/95 backdrop-blur-sm border border-unbox-light shadow-md hover:shadow-lg hover:bg-white flex items-center justify-center transition-all"
                    style={{ pointerEvents: 'auto' }}
                >
                    <ChevronLeft size={18} className="text-unbox-dark" />
                </button>
            )}

            {/* Right button */}
            {canScrollRight && (
                <button
                    type="button"
                    onClick={() => scrollBy(stepPx)}
                    aria-label="Прокрутить вправо"
                    className="absolute right-2 top-1/2 -translate-y-1/2 z-20 w-9 h-9 rounded-full bg-white/95 backdrop-blur-sm border border-unbox-light shadow-md hover:shadow-lg hover:bg-white flex items-center justify-center transition-all"
                    style={{ pointerEvents: 'auto' }}
                >
                    <ChevronRight size={18} className="text-unbox-dark" />
                </button>
            )}

            {/* The actual scroll container */}
            <div
                ref={scrollRef}
                onKeyDown={handleKeyDown}
                tabIndex={0}
                className="overflow-x-auto scrollbar-visible rounded-xl border border-unbox-light shadow-sm bg-white focus:outline-none focus-visible:ring-2 focus-visible:ring-unbox-green/40"
            >
                {children}
            </div>
        </div>
    );
}
