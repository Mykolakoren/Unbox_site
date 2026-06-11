import { Loader2, ArrowDown } from 'lucide-react';

/**
 * Pull-to-refresh visual: shows arrow while pulling, then spinner while
 * refresh is in flight. Distance comes from `usePullToRefresh`.
 */
export function PullIndicator({ distance, willRefresh, refreshing }: {
    distance: number;
    willRefresh: boolean;
    refreshing: boolean;
}) {
    const visible = distance > 4 || refreshing;
    const opacity = refreshing ? 1 : Math.min(1, distance / 60);
    return (
        <div style={{
            height: refreshing ? 36 : Math.min(60, distance),
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: willRefresh ? '#0E0E0E' : '#999',
            opacity: visible ? opacity : 0,
            transition: refreshing ? 'height 0.2s ease' : undefined,
            fontSize: 12,
            fontWeight: 600,
            gap: 6,
        }}>
            {refreshing
                ? <><Loader2 size={14} className="animate-spin" /> Обновляю</>
                : <><ArrowDown size={14} style={{ transform: willRefresh ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }} /> {willRefresh ? 'Отпусти' : 'Потяни'}</>
            }
        </div>
    );
}
