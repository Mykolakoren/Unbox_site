import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { Search, X, User as UserIcon, Calendar, MapPin, BookOpen, ArrowRight } from 'lucide-react';
import { useUserStore } from '../../store/userStore';
import { COLOR, FONT, SHADOW, Z } from '../../design/tokens';
import { useCrmStore } from '../../store/crmStore';
import { RESOURCES, LOCATIONS } from '../../utils/data';
import { formatDayMonth, formatGel, formatMoney } from '../../utils/format';

/**
 * Cmd+K / Ctrl+K universal search. Owner 2026-05-27: admins used to
 * jump between /admin/users, /admin/bookings, /crm/clients, /admin/cabinets
 * — now they just open this overlay anywhere and start typing.
 *
 * Scope (LOCAL data, no extra API calls — uses already-loaded stores):
 *   - Users (email, name, phone)
 *   - CRM clients (name, alias code)
 *   - Cabinets (name, location)
 *   - Locations (name, address)
 *   - Future bookings (resource + start time + user email)
 *
 * Results are ranked by:
 *   1. Exact prefix match (highest)
 *   2. Word-boundary match
 *   3. Substring match
 *
 * Open via Cmd+K (mac) / Ctrl+K (other), Esc closes. Mounted globally
 * by `<CmdKProvider>` so the binding works on every admin page.
 */

/** Событие «открыть поиск» — кнопка «Найти клиента или бронь ⌘K» в шапке админки. */
const OPEN_EVENT = 'unbox:cmdk-open';

/** Открыть поиск ⌘K из любого места (кнопка в шапке). */
export function openCmdK(): void {
    if (typeof window !== 'undefined') window.dispatchEvent(new Event(OPEN_EVENT));
}

interface ResultItem {
    id: string;
    kind: 'user' | 'crm_client' | 'cabinet' | 'location' | 'booking';
    title: string;
    sub: string;
    href: string;
    score: number;
}

export function CmdKSearch({ open, onClose }: { open: boolean; onClose: () => void }) {
    const [q, setQ] = useState('');
    const inputRef = useRef<HTMLInputElement>(null);
    const navigate = useNavigate();

    const users = useUserStore(s => s.users);
    const bookings = useUserStore(s => s.bookings);
    const fetchUsers = useUserStore(s => s.fetchUsers);
    const clients = useCrmStore(s => s.clients);

    useEffect(() => {
        if (open) {
            setQ('');
            setTimeout(() => inputRef.current?.focus(), 30);
            // Открыли поиск со страницы, где клиенты ещё не загружены
            // (например, «Кабинеты») — подгружаем, иначе «ничего не найдено».
            if (users.length === 0) fetchUsers();
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open]);

    const results = useMemo(() => {
        const needle = q.trim().toLowerCase();
        if (!needle || needle.length < 2) return [];

        const out: ResultItem[] = [];
        const score = (text: string): number => {
            const t = text.toLowerCase();
            if (t.startsWith(needle)) return 100;
            if (t.split(/[\s,@.]+/).some(w => w.startsWith(needle))) return 70;
            if (t.includes(needle)) return 40;
            return 0;
        };

        for (const u of users) {
            const s = Math.max(
                score(u.name || ''), score(u.email || ''), score(u.phone || ''),
            );
            if (s > 0) {
                out.push({
                    id: `user-${u.id}`,
                    kind: 'user',
                    title: u.name || u.email,
                    sub: `${u.email}${u.phone ? ' · ' + u.phone : ''} · баланс ${formatGel(u.balance ?? 0, { fraction: 0 })}`,
                    // Маршрут карточки — /admin/users/:email (по id карточка не открывалась).
                    href: `/admin/users/${encodeURIComponent(u.email)}`,
                    score: s,
                });
            }
        }

        for (const c of clients) {
            const s = Math.max(
                score(c.name || ''), score(c.aliasCode || ''),
            );
            if (s > 0) {
                out.push({
                    id: `client-${c.id}`,
                    kind: 'crm_client',
                    title: c.aliasCode ? `${c.aliasCode} · ${c.name}` : c.name,
                    sub: `CRM-клиент${c.basePrice ? ' · ' + formatMoney(c.basePrice, { currency: c.currency || 'GEL' }) : ''}`,
                    href: `/crm/clients/${c.id}`,
                    score: s + 5,  // CRM admins query clients more often
                });
            }
        }

        for (const r of RESOURCES) {
            if (r.isActive === false) continue;
            const s = Math.max(score(r.name || ''), score(r.id));
            if (s > 0) {
                const loc = LOCATIONS.find(l => l.id === r.locationId);
                out.push({
                    id: `cab-${r.id}`,
                    kind: 'cabinet',
                    title: r.name,
                    sub: `${loc?.name || r.locationId} · ${formatGel(r.hourlyRate)}/ч · до ${r.capacity}`,
                    href: `/admin/cabinets`,
                    score: s,
                });
            }
        }

        for (const l of LOCATIONS) {
            const s = Math.max(score(l.name || ''), score(l.address || ''));
            if (s > 0) {
                out.push({
                    id: `loc-${l.id}`,
                    kind: 'location',
                    title: l.name,
                    sub: l.address,
                    href: `/location/${l.id}`,
                    score: s,
                });
            }
        }

        // Future bookings — match by user email or resource name
        const now = Date.now();
        for (const b of bookings.slice(0, 500)) {
            if (b.status !== 'confirmed') continue;
            const dt = b.date ? new Date(b.date as any).getTime() : 0;
            if (dt < now - 24 * 3600 * 1000) continue;
            const resName = RESOURCES.find(r => r.id === b.resourceId)?.name || b.resourceId || '';
            const s = Math.max(score(b.userId || ''), score(resName));
            if (s > 0) {
                const d = new Date(b.date as any);
                const dayLabel = isFinite(d.getTime())
                    ? formatDayMonth(d)
                    : '';
                out.push({
                    id: `bk-${b.id}`,
                    kind: 'booking',
                    title: `${resName} · ${b.startTime}`,
                    sub: `${dayLabel} · ${b.userId} · ${formatGel(b.finalPrice ?? 0, { fraction: 0 })}`,
                    // Шахматка понимает ?highlight= — откроет день и карточку брони.
                    href: `/admin/bookings?view=grid&highlight=${b.id}`,
                    score: s - 10,  // bookings are noisier — small penalty
                });
            }
        }

        return out.sort((a, b) => b.score - a.score).slice(0, 30);
    }, [q, users, bookings, clients]);

    if (!open) return null;

    const go = (href: string) => {
        onClose();
        navigate(href);
    };

    const iconFor = (k: ResultItem['kind']) => {
        if (k === 'user') return <UserIcon size={14} />;
        if (k === 'crm_client') return <BookOpen size={14} />;
        if (k === 'cabinet') return <MapPin size={14} />;
        if (k === 'location') return <MapPin size={14} />;
        return <Calendar size={14} />;
    };
    const labelFor = (k: ResultItem['kind']) => ({
        user: 'Клиент', crm_client: 'CRM',
        cabinet: 'Кабинет', location: 'Локация', booking: 'Бронь',
    })[k];

    return createPortal(
        <div
            onClick={onClose}
            style={{
                position: 'fixed', inset: 0, zIndex: Z.dialog,
                background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)', WebkitBackdropFilter: 'blur(4px)',
                display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
                paddingTop: 'min(15vh, 100px)',
                padding: '15vh 16px 16px',
                fontFamily: FONT.sans,
            }}
        >
            <div
                role="dialog"
                aria-modal="true"
                aria-label="Поиск по админке"
                onClick={e => e.stopPropagation()}
                style={{
                    width: '100%', maxWidth: 560,
                    background: COLOR.card, borderRadius: 0,
                    overflow: 'hidden',
                    boxShadow: SHADOW.pop,
                    display: 'flex', flexDirection: 'column',
                    maxHeight: '70vh',
                }}
            >
                {/* Search bar */}
                <div style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    padding: '14px 16px',
                    borderBottom: '1px solid rgba(0,0,0,0.08)',
                }}>
                    <Search size={18} style={{ color: COLOR.ink60, flexShrink: 0 }} aria-hidden="true" />
                    <input
                        ref={inputRef}
                        type="text"
                        value={q}
                        onChange={e => setQ(e.target.value)}
                        onKeyDown={e => {
                            if (e.key === 'Escape') onClose();
                            if (e.key === 'Enter' && results[0]) go(results[0].href);
                        }}
                        placeholder="Имя, телефон, почта, кабинет…"
                        aria-label="Поиск по админке"
                        style={{
                            flex: 1, border: 'none', outline: 'none',
                            fontSize: 16, fontFamily: 'inherit',
                            color: COLOR.ink, background: 'transparent',
                        }}
                    />
                    <button
                        onClick={onClose}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: COLOR.ink60, padding: 4 }}
                        aria-label="Закрыть"
                    >
                        <X size={18} />
                    </button>
                </div>

                {/* Results */}
                <div style={{ overflowY: 'auto', flex: 1 }}>
                    {q.trim().length < 2 ? (
                        <div style={{ padding: 24, textAlign: 'center', color: COLOR.ink60, fontSize: 14 }}>
                            Начните вводить — найдём клиентов, кабинеты и брони.
                        </div>
                    ) : results.length === 0 ? (
                        <div style={{ padding: 24, textAlign: 'center', color: COLOR.ink60, fontSize: 14 }}>
                            Ничего не найдено по запросу «{q}»
                        </div>
                    ) : (
                        results.map(r => (
                            <button
                                key={r.id}
                                onClick={() => go(r.href)}
                                style={{
                                    width: '100%',
                                    background: 'transparent', border: 'none',
                                    padding: '11px 16px',
                                    display: 'flex', alignItems: 'center', gap: 12,
                                    cursor: 'pointer', textAlign: 'left',
                                    fontFamily: 'inherit',
                                    borderBottom: '1px solid rgba(0,0,0,0.04)',
                                }}
                                onMouseEnter={e => (e.currentTarget.style.background = COLOR.sunken)}
                                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                            >
                                <div style={{
                                    width: 30, height: 30, borderRadius: 7,
                                    background: COLOR.ink05,
                                    color: COLOR.ink,
                                    display: 'grid', placeItems: 'center', flexShrink: 0,
                                }}>
                                    {iconFor(r.kind)}
                                </div>
                                <div style={{ flex: 1, minWidth: 0 }}>
                                    <div style={{
                                        fontWeight: 600, fontSize: 14, color: COLOR.ink,
                                        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                                    }}>
                                        {r.title}
                                    </div>
                                    <div style={{
                                        fontSize: 12, color: COLOR.ink60,
                                        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                                        marginTop: 1,
                                    }}>
                                        {r.sub}
                                    </div>
                                </div>
                                <span style={{
                                    fontSize: 12, fontWeight: 600, letterSpacing: '0.05em',
                                    textTransform: 'uppercase', color: COLOR.ink60,
                                    background: COLOR.ink05,
                                    padding: '2px 6px', borderRadius: 4, flexShrink: 0,
                                }}>{labelFor(r.kind)}</span>
                                <ArrowRight size={14} style={{ color: COLOR.ink40, flexShrink: 0 }} aria-hidden="true" />
                            </button>
                        ))
                    )}
                </div>

                {/* Footer hint */}
                <div style={{
                    padding: '8px 16px',
                    borderTop: '1px solid rgba(0,0,0,0.04)',
                    fontSize: 12, color: COLOR.ink60,
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    background: COLOR.paper,
                }}>
                    <span>↵ открыть · Esc закрыть</span>
                    <span>⌘K / Ctrl+K</span>
                </div>
            </div>
        </div>,
        document.body,
    );
}

/** Provider: listens for Cmd+K globally and renders the overlay.
 *  Mount once near the app root (after AuthN check ideally). */
export function CmdKProvider() {
    const [open, setOpen] = useState(false);

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            const isCombo = (e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K');
            if (isCombo) {
                e.preventDefault();
                setOpen(o => !o);
            }
        };
        const onOpen = () => setOpen(true);
        window.addEventListener('keydown', onKey);
        window.addEventListener(OPEN_EVENT, onOpen);
        return () => {
            window.removeEventListener('keydown', onKey);
            window.removeEventListener(OPEN_EVENT, onOpen);
        };
    }, []);

    return <CmdKSearch open={open} onClose={() => setOpen(false)} />;
}
