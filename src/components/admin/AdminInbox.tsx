import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, ArrowRight, CreditCard, ShieldCheck, Calendar, Wrench } from 'lucide-react';
import { bookingsApi } from '../../api/bookings';
import { api } from '../../api/client';
import type { BookingHistoryItem, User } from '../../store/types';
import { GH, GH_MONO, GH_SANS } from '../../hooks/useDesignFlag';

/**
 * Admin Inbox — single feed of "things that need your attention TODAY".
 *
 * Why this exists: admin energy was scattered across 4-5 pages (hot-bookings
 * Inbox tab, specialists Verify queue, Users with debt, etc.). Now the
 * dashboard surfaces them in one ranked list at the top, so the admin can
 * triage in 30 seconds and only dive deep into the few that warrant it.
 *
 * Items pulled (in priority order):
 *   1. Hot bookings awaiting approval — most urgent (clients waiting now)
 *   2. Specialist applications pending verification
 *   3. Users over their credit limit (negative balance > creditLimit)
 *   4. Users with negative balance but no credit limit set
 *
 * Each row is tap/click to navigate to the relevant resolution page.
 * Empty inbox shows a celebratory state — "всё чисто".
 */

interface PendingSpec {
    id: string;
    first_name: string;
    last_name: string;
    application_status: string | null;
}

interface InboxItem {
    id: string;
    kind: 'hot_booking' | 'pending_specialist' | 'credit_over' | 'negative_no_credit';
    title: string;
    sub: string;
    href: string;
    severity: 'urgent' | 'warn' | 'info';
}

export function AdminInbox({ users }: { users: User[] }) {
    const [pending, setPending] = useState<BookingHistoryItem[] | null>(null);
    const [pendingSpecs, setPendingSpecs] = useState<PendingSpec[] | null>(null);
    const [loaded, setLoaded] = useState(false);

    useEffect(() => {
        Promise.allSettled([
            bookingsApi.getPendingApprovals(),
            api.get<PendingSpec[]>('/specialists/admin/all'),
        ]).then(([p1, p2]) => {
            if (p1.status === 'fulfilled') setPending(p1.value);
            if (p2.status === 'fulfilled') {
                setPendingSpecs(p2.value.data.filter(s => s.application_status === 'pending'));
            }
            setLoaded(true);
        });
    }, []);

    const items: InboxItem[] = useMemo(() => {
        const out: InboxItem[] = [];

        // 1. Hot bookings
        if (pending && pending.length > 0) {
            out.push({
                id: 'hot',
                kind: 'hot_booking',
                title: `${pending.length} hot-${pending.length === 1 ? 'бронь' : 'броней'} ждёт одобрения`,
                sub: 'Клиент пишет «срочно нужно». Вы — последний фильтр.',
                href: '/admin/bookings?status=pending',
                severity: 'urgent',
            });
        }

        // 2. Pending specialist applications
        if (pendingSpecs && pendingSpecs.length > 0) {
            const names = pendingSpecs.slice(0, 2).map(s => `${s.first_name} ${s.last_name}`).join(', ');
            out.push({
                id: 'specs',
                kind: 'pending_specialist',
                title: `${pendingSpecs.length} заявок специалистов`,
                sub: names + (pendingSpecs.length > 2 ? `, +${pendingSpecs.length - 2}` : ''),
                href: '/admin/specialists',
                severity: 'warn',
            });
        }

        // 3. Users with debt over credit limit
        const overLimit = users.filter(u => {
            const debt = (u.balance ?? 0) < 0 ? -(u.balance ?? 0) : 0;
            return debt > 0 && (u.creditLimit ?? 0) > 0 && debt > (u.creditLimit ?? 0);
        });
        if (overLimit.length > 0) {
            const top = overLimit
                .slice()
                .sort((a, b) => (Math.abs(b.balance ?? 0)) - (Math.abs(a.balance ?? 0)))
                .slice(0, 2);
            out.push({
                id: 'over',
                kind: 'credit_over',
                title: `${overLimit.length} клиентов сверх кредитного лимита`,
                sub: top.map(u => `${u.name} (${(u.balance ?? 0).toFixed(0)} ₾)`).join(' · '),
                href: '/admin/users?filter=over_limit',
                severity: 'urgent',
            });
        }

        // 4. Negative balance + no credit limit
        const negNoCredit = users.filter(u => (u.balance ?? 0) < 0 && (u.creditLimit ?? 0) === 0);
        if (negNoCredit.length > 0) {
            const top = negNoCredit
                .slice()
                .sort((a, b) => (a.balance ?? 0) - (b.balance ?? 0))
                .slice(0, 2);
            out.push({
                id: 'neg_no_credit',
                kind: 'negative_no_credit',
                title: `${negNoCredit.length} в минусе без кредит-лимита`,
                sub: top.map(u => `${u.name} (${(u.balance ?? 0).toFixed(0)} ₾)`).join(' · '),
                href: '/admin/users?filter=negative_no_credit',
                severity: 'warn',
            });
        }

        return out;
    }, [pending, pendingSpecs, users]);

    if (!loaded) {
        return (
            <div style={{
                marginBottom: 24, padding: '14px 16px',
                border: `1px solid ${GH.ink10}`,
                color: GH.ink60,
                fontFamily: GH_MONO, fontSize: 11, letterSpacing: '0.04em',
            }}>
                INBOX · загрузка…
            </div>
        );
    }

    if (items.length === 0) {
        return (
            <div style={{
                marginBottom: 24, padding: '14px 16px',
                border: `1px solid ${GH.ink10}`,
                background: 'rgba(76,138,107,0.04)',
                color: GH.ink60,
                fontFamily: GH_SANS, fontSize: 13,
                display: 'flex', alignItems: 'center', gap: 10,
            }}>
                <ShieldCheck size={16} style={{ color: '#1B7430' }} />
                <span>
                    <b style={{ color: GH.ink }}>Inbox пуст.</b> Hot-бронь, заявки специалистов, минусовые балансы — всё под контролем.
                </span>
            </div>
        );
    }

    return (
        <div style={{ marginBottom: 24 }}>
            <div style={{
                fontFamily: GH_MONO, fontSize: 10, letterSpacing: '0.18em', textTransform: 'uppercase',
                color: GH.ink60, marginBottom: 10,
                display: 'flex', alignItems: 'center', gap: 6,
            }}>
                <AlertTriangle size={11} /> Требует внимания · {items.length}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {items.map(item => (
                    <InboxRow key={item.id} item={item} />
                ))}
            </div>
        </div>
    );
}

function InboxRow({ item }: { item: InboxItem }) {
    const colorFor = (sev: InboxItem['severity']) => {
        if (sev === 'urgent') return { bg: '#FEF2F2', border: '#FCA5A5', text: '#991B1B', icon: '#B91C1C' };
        if (sev === 'warn')   return { bg: '#FEF3C7', border: '#FBBF24', text: '#92400E', icon: '#D97706' };
        return { bg: '#EFF6FF', border: '#93C5FD', text: '#1E3A8A', icon: '#2563EB' };
    };
    const c = colorFor(item.severity);

    const Icon = item.kind === 'hot_booking' ? AlertTriangle
        : item.kind === 'pending_specialist' ? ShieldCheck
        : item.kind === 'credit_over' ? CreditCard
        : item.kind === 'negative_no_credit' ? Wrench
        : Calendar;

    return (
        <Link
            to={item.href}
            style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                padding: '12px 14px',
                background: c.bg,
                border: `1px solid ${c.border}`,
                borderRadius: 10,
                color: c.text,
                textDecoration: 'none',
                fontFamily: GH_SANS,
            }}
        >
            <div style={{
                width: 36, height: 36, borderRadius: 8,
                background: 'rgba(255,255,255,0.7)',
                color: c.icon,
                display: 'grid', placeItems: 'center', flexShrink: 0,
            }}>
                <Icon size={18} />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: 14, lineHeight: 1.25 }}>{item.title}</div>
                <div style={{
                    fontSize: 12, opacity: 0.85, marginTop: 2,
                    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                }}>
                    {item.sub}
                </div>
            </div>
            <ArrowRight size={16} style={{ opacity: 0.5, flexShrink: 0 }} />
        </Link>
    );
}
