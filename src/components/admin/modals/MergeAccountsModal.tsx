import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Loader2, Search, ArrowRight, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import clsx from 'clsx';
import { usersApi } from '../../../api/users';
import { bookingsApi } from '../../../api/bookings';
import { formatDayMonth, formatGel } from '../../../utils/format';
import { subscriptionLifecycle } from '../../../utils/subscription';
import type { User } from '../../../store/types';

type Counts = { total: number; upcoming: number };

// Абонемент «есть» так же, как считает сервер (users/admin.py merge_users:
// `if not tgt.subscription and src.subscription`) — пустой объект = нет.
const hasSub = (u: User) => !!u.subscription && Object.keys(u.subscription).length > 0;

function subLabel(u: User): string {
    if (!hasSub(u)) return 'нет';
    const s: any = u.subscription;
    const left = Number(s.remainingHours ?? 0);
    const until = s.expiryDate ? formatDayMonth(s.expiryDate, { withYear: 'auto', fallback: '' }) : '';
    const state = subscriptionLifecycle(s);
    const tail = state === 'completed' ? ' · завершён' : state === 'frozen' ? ' · на паузе' : '';
    return `${s.name || 'Абонемент'} · ${left} ч${until ? ` до ${until}` : ''}${tail}`;
}

const money = (n: number) => formatGel(n);

async function loadCounts(email: string): Promise<Counts> {
    const list = await bookingsApi.getUserBookings(email);
    const now = Date.now();
    const upcoming = list.filter(b => {
        if (b.status !== 'confirmed') return false;
        const raw: any = b.date;
        const day = typeof raw === 'string' ? raw.split('T')[0].split(' ')[0] : '';
        const ms = day ? new Date(`${day}T${b.startTime || '00:00'}`).getTime() : NaN;
        return !isNaN(ms) && ms >= now;
    }).length;
    return { total: list.length, upcoming };
}

/**
 * Склейка дубликата с этой карточкой — вместо prompt() с email вслепую
 * (аудит 29.09, G7-04). Админ находит дубликат поиском и до подтверждения
 * видит оба аккаунта: имя, баланс, абонемент, брони, — и что будет после.
 * Склейка необратима: дубликат удаляется, поэтому ещё и галочка «понимаю».
 */
export function MergeAccountsModal({
    open,
    onClose,
    target,
    users,
    onMerged,
}: {
    open: boolean;
    onClose: () => void;
    /** Карточка, которая ОСТАНЕТСЯ (та, где нажали «Слить»). */
    target: User;
    users: User[];
    onMerged: () => void | Promise<void>;
}) {
    const [query, setQuery] = useState('');
    const [source, setSource] = useState<User | null>(null);
    const [counts, setCounts] = useState<{ source: Counts; target: Counts } | null>(null);
    const [countsError, setCountsError] = useState(false);
    const [agree, setAgree] = useState(false);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        if (open) {
            setQuery('');
            setSource(null);
            setCounts(null);
            setCountsError(false);
            setAgree(false);
            setSaving(false);
        }
    }, [open]);

    // Брони обоих аккаунтов — с сервера, по email (как вкладка «Бронирования»).
    useEffect(() => {
        if (!source) return;
        let cancelled = false;
        setCounts(null);
        setCountsError(false);
        Promise.all([loadCounts(source.email), loadCounts(target.email)])
            .then(([s, t]) => { if (!cancelled) setCounts({ source: s, target: t }); })
            .catch(() => { if (!cancelled) setCountsError(true); });
        return () => { cancelled = true; };
    }, [source, target.email]);

    const matches = useMemo(() => {
        const q = query.trim().toLowerCase();
        if (q.length < 2) return [];
        const digits = q.replace(/\D/g, '');
        return users
            .filter(u => u.id !== target.id && !(u.email || '').startsWith('merged-into-'))
            .filter(u =>
                (u.name || '').toLowerCase().includes(q)
                || (u.email || '').toLowerCase().includes(q)
                || u.id === query.trim()
                || (digits.length >= 4 && (u.phone || '').replace(/\D/g, '').includes(digits)),
            )
            .slice(0, 8);
    }, [query, users, target.id]);

    if (!open) return null;

    const close = () => { if (!saving) onClose(); };

    const merge = async () => {
        if (!source || !agree || saving) return;
        setSaving(true);
        try {
            await usersApi.mergeUsers(source.id, target.id);
            toast.success(`${source.name || source.email} склеен с этой карточкой`);
            onClose();
            await onMerged();
        } catch (err: any) {
            const d = err?.response?.data?.detail;
            toast.error(typeof d === 'string' ? d : 'Не удалось склеить аккаунты');
        } finally {
            setSaving(false);
        }
    };

    const sourceName = source ? (source.name || source.email) : '';
    const bothSubs = source ? hasSub(source) && hasSub(target) : false;

    return createPortal(
        <div className="fixed inset-0 z-[1000] flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={close} />
            <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-2xl p-6 max-h-[calc(100vh-32px)] overflow-y-auto">
                <button
                    type="button"
                    onClick={close}
                    aria-label="Закрыть"
                    className="absolute top-4 right-4 text-ink-60 hover:text-unbox-dark"
                >
                    <X size={20} />
                </button>

                <h3 className="text-xl font-bold text-unbox-dark mb-1">Склеить дубликат с этой карточкой</h3>
                <p className="text-sm text-ink-60 mb-4">
                    Брони, оплаты и баланс дубликата перейдут к {target.name || target.email}.
                    Дубликат удалится — отменить склейку нельзя.
                </p>

                {!source ? (
                    <>
                        <label className="relative block">
                            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-60" />
                            <input
                                autoFocus
                                value={query}
                                onChange={e => setQuery(e.target.value)}
                                placeholder="Найдите дубликат: имя, email или телефон"
                                className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-unbox-light text-sm focus:outline-none focus:border-unbox-green"
                            />
                        </label>
                        <div className="mt-2 space-y-1">
                            {query.trim().length >= 2 && matches.length === 0 && (
                                <div className="text-sm text-ink-60 px-1 py-2">Никого не нашли</div>
                            )}
                            {matches.map(u => (
                                <button
                                    key={u.id}
                                    type="button"
                                    onClick={() => setSource(u)}
                                    className="w-full text-left px-3 py-2 rounded-xl hover:bg-unbox-light/50 flex items-center justify-between gap-3"
                                >
                                    <span className="min-w-0">
                                        <span className="block text-sm font-medium text-unbox-dark truncate">{u.name || '—'}</span>
                                        <span className="block text-xs text-ink-60 truncate">{u.email}{u.phone ? ` · ${u.phone}` : ''}</span>
                                    </span>
                                    <span className={clsx('shrink-0 text-xs tabular-nums', Number(u.balance || 0) < 0 ? 'text-[var(--status-danger-fg)]' : 'text-ink-60')}>
                                        {money(Number(u.balance || 0))}
                                    </span>
                                </button>
                            ))}
                        </div>
                        <p className="text-xs text-ink-60 mt-3">
                            Оставить нужно другой аккаунт? Откройте его карточку и склейте оттуда.
                        </p>
                    </>
                ) : (
                    <>
                        <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto_1fr] gap-3 items-stretch">
                            <AccountBox
                                title="Дубликат — удалится"
                                tone="danger"
                                user={source}
                                counts={counts?.source}
                                countsError={countsError}
                            />
                            <div className="hidden sm:flex items-center text-ink-60">
                                <ArrowRight size={20} />
                            </div>
                            <AccountBox
                                title="Эта карточка — останется"
                                tone="keep"
                                user={target}
                                counts={counts?.target}
                                countsError={countsError}
                            />
                        </div>

                        <div className="mt-4 rounded-xl bg-unbox-light/30 border border-unbox-light p-3 text-sm text-unbox-dark space-y-1">
                            <div className="font-semibold">После склейки у {target.name || target.email}:</div>
                            <div>
                                Баланс: {money(Number(target.balance || 0) + Number(source.balance || 0))}
                                {Math.abs(Number(source.balance || 0)) >= 0.01 && (
                                    <span className="text-ink-60"> ({money(Number(target.balance || 0))} {Number(source.balance) < 0 ? '−' : '+'} {money(Math.abs(Number(source.balance || 0)))})</span>
                                )}
                            </div>
                            <div>
                                Броней: {counts ? counts.target.total + counts.source.total : countsError ? '—' : '…'}
                            </div>
                            <div>
                                Абонемент: {hasSub(target)
                                    ? 'остаётся абонемент этой карточки'
                                    : hasSub(source) ? 'переходит абонемент дубликата' : 'нет'}
                            </div>
                            {bothSubs && (
                                <div className="flex items-start gap-1.5 text-[var(--status-danger-fg)] font-medium pt-1">
                                    <AlertTriangle size={14} className="shrink-0 mt-0.5" />
                                    Абонемент дубликата ({subLabel(source)}) пропадёт — часы не суммируются.
                                </div>
                            )}
                        </div>

                        <label className="mt-4 flex items-start gap-2 text-sm text-unbox-dark cursor-pointer">
                            <input
                                type="checkbox"
                                checked={agree}
                                onChange={e => setAgree(e.target.checked)}
                                className="mt-0.5"
                            />
                            Понимаю: аккаунт {sourceName} удалится, отменить нельзя
                        </label>

                        <div className="flex flex-wrap gap-3 mt-5">
                            <button
                                type="button"
                                onClick={() => { setSource(null); setAgree(false); }}
                                disabled={saving}
                                className="flex-1 min-w-[140px] py-2.5 rounded-xl border border-unbox-light text-sm font-medium text-unbox-dark hover:bg-unbox-light/50 disabled:opacity-50"
                            >
                                Выбрать другой
                            </button>
                            <button
                                type="button"
                                onClick={merge}
                                // Ждём подсчёт броней, но не блокируем склейку, если он не загрузился.
                                disabled={!agree || saving || (!counts && !countsError)}
                                className="flex-1 min-w-[140px] py-2.5 rounded-xl bg-[var(--status-danger-solid)] hover:brightness-90 text-white text-sm font-medium disabled:opacity-50 flex items-center justify-center gap-2"
                            >
                                {saving && <Loader2 size={14} className="animate-spin" />}
                                Склеить аккаунты
                            </button>
                        </div>
                    </>
                )}
            </div>
        </div>,
        document.body,
    );
}

function AccountBox({
    title, tone, user, counts, countsError,
}: {
    title: string;
    tone: 'danger' | 'keep';
    user: User;
    counts?: Counts;
    countsError: boolean;
}) {
    const balance = Number(user.balance || 0);
    return (
        <div className={clsx(
            'rounded-xl border p-3 text-sm min-w-0',
            tone === 'danger' ? 'border-[var(--status-danger-fg)]/25 bg-[var(--status-danger-bg)]/50' : 'border-unbox-green/40 bg-unbox-green/5',
        )}>
            <div className={clsx('text-xs font-semibold uppercase tracking-wider mb-2', tone === 'danger' ? 'text-[var(--status-danger-fg)]' : 'text-accent-ink')}>
                {title}
            </div>
            <div className="font-semibold text-unbox-dark truncate">{user.name || '—'}</div>
            <div className="text-xs text-ink-60 truncate mb-2">{user.email}</div>
            <dl className="space-y-1 text-xs">
                <Row label="Баланс" value={<span className={balance < 0 ? 'text-[var(--status-danger-fg)] font-semibold num' : 'font-semibold num'}>{money(balance)}</span>} />
                <Row label="Абонемент" value={subLabel(user)} />
                <Row
                    label="Броней"
                    value={counts ? `${counts.total}${counts.upcoming ? ` (впереди ${counts.upcoming})` : ''}` : countsError ? 'не загрузились' : '…'}
                />
                <Row label="Телефон" value={user.phone || '—'} />
                <Row label="Telegram" value={user.telegramId ? 'привязан' : '—'} />
            </dl>
        </div>
    );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
    return (
        <div className="flex justify-between gap-2">
            <dt className="text-ink-60 shrink-0">{label}</dt>
            <dd className="text-unbox-dark text-right min-w-0 break-words">{value}</dd>
        </div>
    );
}
