import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, ArrowRight, CreditCard, ShieldCheck, Calendar, Wrench } from 'lucide-react';
import { bookingsApi } from '../../api/bookings';
import { api } from '../../api/client';
import type { BookingHistoryItem, User } from '../../store/types';
import { GH, GH_MONO, GH_SANS } from '../../hooks/useDesignFlag';
import { COLOR, STATUS } from '../../design/tokens';
import { ruCountWord } from '../../utils/plural';
import { formatGel } from '../../utils/format';
import { Skeleton } from '../ui/Skeleton';
import { ErrorBar } from '../ui/ErrorBar';

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
    // Запрос упал — не пишем «всё разобрано»: это была бы неправда (wave 1).
    const [failed, setFailed] = useState(false);
    const [reloadTick, setReloadTick] = useState(0);

    useEffect(() => {
        Promise.allSettled([
            bookingsApi.getPendingApprovals(),
            api.get<PendingSpec[]>('/specialists/admin/all'),
        ]).then(([p1, p2]) => {
            if (p1.status === 'fulfilled') setPending(p1.value);
            if (p2.status === 'fulfilled') {
                setPendingSpecs(p2.value.data.filter(s => s.application_status === 'pending'));
            }
            setFailed(p1.status === 'rejected' || p2.status === 'rejected');
            setLoaded(true);
        });
    }, [reloadTick]);

    const items: InboxItem[] = useMemo(() => {
        const out: InboxItem[] = [];

        // 1. Hot bookings
        if (pending && pending.length > 0) {
            out.push({
                id: 'hot',
                kind: 'hot_booking',
                title: `${ruCountWord(pending.length, ['срочная бронь', 'срочные брони', 'срочных броней'])} ${pending.length % 10 === 1 && pending.length % 100 !== 11 ? 'ждёт' : 'ждут'} подтверждения`,
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
                title: ruCountWord(pendingSpecs.length, ['заявка специалиста', 'заявки специалистов', 'заявок специалистов']),
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
                title: `${ruCountWord(overLimit.length, ['клиент', 'клиента', 'клиентов'])} сверх кредитного лимита`,
                sub: top.map(u => `${u.name} (${formatGel(u.balance ?? 0, { fraction: 0 })})`).join(' · '),
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
                title: `${ruCountWord(negNoCredit.length, ['клиент', 'клиента', 'клиентов'])} в минусе без кредит-лимита`,
                sub: top.map(u => `${u.name} (${formatGel(u.balance ?? 0, { fraction: 0 })})`).join(' · '),
                href: '/admin/users?filter=negative_no_credit',
                severity: 'warn',
            });
        }

        return out;
    }, [pending, pendingSpecs, users]);

    if (!loaded) {
        return (
            <div
                role="status"
                aria-busy="true"
                style={{ marginBottom: 24, display: 'flex', flexDirection: 'column', gap: 8 }}
            >
                <span className="sr-only">Загружаем входящие…</span>
                <Skeleton height={62} radius={10} />
            </div>
        );
    }

    const retry = () => { setLoaded(false); setReloadTick(t => t + 1); };

    if (failed && items.length === 0) {
        return (
            <div style={{ marginBottom: 24 }}>
                <ErrorBar message="Не удалось проверить срочные брони и заявки" onRetry={retry} />
            </div>
        );
    }

    if (items.length === 0) {
        return (
            <div style={{
                marginBottom: 24, padding: '14px 16px',
                border: `1px solid ${GH.ink10}`,
                background: STATUS.ok.bg,
                color: GH.ink60,
                fontFamily: GH_SANS, fontSize: 14,
                display: 'flex', alignItems: 'center', gap: 10,
            }}>
                <ShieldCheck size={16} style={{ color: STATUS.ok.fg }} aria-hidden="true" />
                <span>
                    <b style={{ color: GH.ink, fontWeight: 600 }}>Всё разобрано.</b> Срочные брони, заявки специалистов, минусовые балансы — под контролем.
                </span>
            </div>
        );
    }

    return (
        <div style={{ marginBottom: 24 }}>
            {failed && (
                <div style={{ marginBottom: 8 }}>
                    <ErrorBar message="Часть входящих не загрузилась" onRetry={retry} />
                </div>
            )}
            <div style={{
                fontFamily: GH_MONO, fontSize: 12, letterSpacing: '0.06em', textTransform: 'uppercase',
                color: GH.ink60, marginBottom: 10,
                display: 'flex', alignItems: 'center', gap: 6,
            }}>
                <AlertTriangle size={14} aria-hidden="true" /> Требует внимания · {items.length}
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
        // Только статусные токены: срочно — «опасно», ждёт — «ждём», прочее — «инфо».
        const t = sev === 'urgent' ? STATUS.danger : sev === 'warn' ? STATUS.pending : STATUS.info;
        return { bg: t.bg, border: `${t.fg}40`, text: t.fg, icon: t.fg };
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
                background: COLOR.card,
                color: c.icon,
                display: 'grid', placeItems: 'center', flexShrink: 0,
            }}>
                <Icon size={18} />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: 14, lineHeight: 1.25 }}>{item.title}</div>
                <div style={{
                    fontSize: 12, marginTop: 2,
                    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                }}>
                    {item.sub}
                </div>
            </div>
            <ArrowRight size={16} style={{ flexShrink: 0 }} aria-hidden="true" />
        </Link>
    );
}
