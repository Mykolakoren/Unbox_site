import { useEffect, useState } from 'react';
import { specialistsApi, type AvailableSlot } from '../../api/specialists';
import { GH, GH_MONO, GH_SANS } from '../../hooks/useDesignFlag';

interface Props {
    specialistId: string;
    /** How many slots to show at the top. 5 is a good balance. */
    count?: number;
    /** Called when the user clicks a slot chip. The chessboard below can
     *  scroll to that date and preselect the slot. */
    onPickSlot?: (slot: AvailableSlot) => void;
}

/**
 * Compact "next N free slots" row above the full chessboard on the
 * specialist profile page. Saves the client from browsing a 14-day grid
 * just to answer "when can I see Nikolai?". Silent no-op when nothing's
 * returned — the chessboard below still works.
 */
export function NextAvailableSlots({ specialistId, count = 5, onPickSlot }: Props) {
    const [slots, setSlots] = useState<AvailableSlot[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(false);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                setLoading(true);
                setError(false);
                const now = new Date();
                const to = new Date(now);
                to.setDate(to.getDate() + 14);
                const dateFrom = now.toISOString().slice(0, 10);
                const dateTo = to.toISOString().slice(0, 10);
                const all = await specialistsApi.getAvailableSlots(specialistId, dateFrom, dateTo);
                if (cancelled) return;
                // Server returns chronologically ordered slots; pick the top N.
                setSlots((all || []).slice(0, count));
            } catch {
                if (!cancelled) setError(true);
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();
        return () => { cancelled = true; };
    }, [specialistId, count]);

    if (loading) return null;       // rendering a skeleton would be noise above the chess
    if (error) return null;         // graceful — chessboard still works
    if (slots.length === 0) return null;

    const fmt = (iso: string) => {
        const d = new Date(iso + 'T00:00:00');
        const today = new Date(); today.setHours(0, 0, 0, 0);
        const tomorrow = new Date(today); tomorrow.setDate(tomorrow.getDate() + 1);
        if (d.getTime() === today.getTime()) return 'Сегодня';
        if (d.getTime() === tomorrow.getTime()) return 'Завтра';
        const months = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
        return `${d.getDate()} ${months[d.getMonth()]}`;
    };

    return (
        <section
            style={{
                marginBottom: 20,
                padding: '16px 20px',
                background: GH.paper,
                border: `1px solid ${GH.ink10}`,
                borderRadius: 12,
                fontFamily: GH_SANS,
            }}
        >
            <div
                style={{
                    fontFamily: GH_MONO,
                    fontSize: 10,
                    letterSpacing: '0.18em',
                    textTransform: 'uppercase',
                    color: GH.ink60,
                    marginBottom: 12,
                }}
            >
                Ближайшие свободные окна
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {slots.map((s, i) => (
                    <button
                        key={`${s.date}-${s.start_time}-${i}`}
                        type="button"
                        onClick={() => onPickSlot?.(s)}
                        style={{
                            padding: '10px 14px',
                            border: `1px solid ${GH.ink}`,
                            background: 'transparent',
                            color: GH.ink,
                            fontSize: 13,
                            fontWeight: 600,
                            cursor: onPickSlot ? 'pointer' : 'default',
                            display: 'flex',
                            flexDirection: 'column',
                            alignItems: 'flex-start',
                            gap: 2,
                            minWidth: 110,
                            transition: 'background 0.12s',
                        }}
                        onMouseEnter={e => { e.currentTarget.style.background = GH.ink5; }}
                        onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
                    >
                        <span style={{
                            fontFamily: GH_MONO,
                            fontSize: 10,
                            letterSpacing: '0.12em',
                            textTransform: 'uppercase',
                            color: GH.ink60,
                        }}>
                            {fmt(s.date)}
                        </span>
                        <span style={{ fontSize: 15, fontWeight: 700 }}>
                            {s.start_time}
                        </span>
                    </button>
                ))}
            </div>
        </section>
    );
}
