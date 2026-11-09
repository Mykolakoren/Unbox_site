import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { UserRound, Check, X, Loader2, CalendarClock, Repeat, Banknote, Plus, Wallet } from 'lucide-react';
import { toast } from 'sonner';
import { useUserStore } from '../../../store/userStore';
import { userCanAccessFinance, hasPermission } from '../../../utils/permissions';
import { useRecentWeeklyRebates } from '../../../hooks/useRecentWeeklyRebates';
import { weeklyRebateNote, rebateFor } from '../../../utils/weeklyRebateNote';
import { bookingsApi } from '../../../api/bookings';
import { RESOURCES } from '../../../utils/data';
import type { BookingHistoryItem, User } from '../../../store/types';
import { Sheet } from '../../../components/ui/Sheet';
import { Button } from '../../../components/ui/Button';
import { Field, Input } from '../../../components/ui/Field';
import { Segmented } from '../../../components/ui/Chip';
import { useConfirmDialog } from '../../../components/ui/ConfirmDialogProvider';
import { formatDayMonth, formatGel } from '../../../utils/format';
import { parseMoneyInput, isMoneyInputBlank, MONEY_INPUT_ERROR } from './parseMoneyInput';
import { toastApiError } from '../../../utils/errors';
import { DueBadge } from '../../../components/admin/DueBadge';
import type { DueInfo } from '../../../utils/dueAmounts';
import { hoursUntilStart, refundPreview } from './cancelRules';
import { statusLabel } from '../../../design/statuses';

/**
 * Шторки брони мобильной админки — ОДНИ на «Брони» и на «Дашборд».
 *
 * Раньше у дашборда была своя шторка: брала обезличенное публичное
 * расписание (ни клиента, ни цены), показывала «0 ₾», кнопка «Цена» с ходу
 * подставляла 0 (сохранишь — клиенту вернётся вся сумма), а «Удалить»
 * всегда возвращала 100% без выбора. Теперь оба экрана открывают одно и то
 * же: действия → отмена с выбором 100/50/0 → смена цены от настоящей.
 *
 * Wave 1: все три шторки — на общем Sheet (слой выше нижнего меню, Esc,
 * свайп, фокус внутри, главная кнопка в подвале всегда видна). Шторка
 * отмены/цены открывается поверх шторки действий — у Sheet есть стек.
 * «Добавить 30 минут» спрашивает общим окном подтверждения, а не confirm().
 */

/** Имя клиента по email/id из списка пользователей (как в «Бронях»). */
export function getAdminUserName(users: User[], email: string | null | undefined): string {
    if (!email) return 'Гость';
    const u = users.find(u => u.email === email || u.id === email);
    if (u?.name) return u.name;
    if (email.includes('@')) return email.split('@')[0];
    return email.slice(0, 12) || 'Гость';
}

/** Контроллер шторок: действия по брони + отмена + смена цены.
 *  После любого действия перечитывает ПОЛНЫЙ админский список броней. */
export function AdminBookingSheets({ booking, getUserName, onClose, acceptPayment, dueInfo, onChanged }: {
    /** Бронь, по которой открыта шторка действий (null — закрыта). */
    booking: BookingHistoryItem | null;
    getUserName: (email: string | null | undefined) => string;
    onClose: () => void;
    /** Волна 4 (G9-24, В3): строка «Принять оплату» — открывает TopupSheet
     *  у родителя. null — брать нечего, строку не показываем. total — весь долг (на кнопке). */
    acceptPayment?: (b: BookingHistoryItem) => { sub: string; onClick: () => void; total?: number } | null;
    /** Ревью 09.11 (admin-design №20): оплата брони в шапке шторки — та же метка, что в строке. */
    dueInfo?: DueInfo;
    /** После действия по брони (кроме общего списка) — например, карточка клиента перечитывает свои брони. */
    onChanged?: () => void;
}) {
    const navigate = useNavigate();
    const fetchAllBookings = useUserStore(s => s.fetchAllBookings);
    // «Принять оплату» (пополнение баланса) — только с правом на кассу, как
    // вкладка «Касса» (волна 4, доработка). Одна проверка на «Сегодня» и «Брони».
    const canCash = userCanAccessFinance(useUserStore(s => s.currentUser));
    // Недельная скидка клиента с последнего понедельника — та же метка, что в
    // «Сегодня» (ревизия 02.10), чтобы её не вычли из «к оплате» второй раз.
    const currentUser = useUserStore(s => s.currentUser);
    const isOwner = currentUser?.role === 'owner';
    const users = useUserStore(s => s.users);
    const rebates = useRecentWeeklyRebates(hasPermission(currentUser, 'finance.view_reports'));
    const rebateOf = (b: BookingHistoryItem): number => {
        const u = users.find(x => x.email === b.userId || x.id === b.userId);
        return rebateFor(rebates, b.userId, u?.id, u?.email);
    };
    const [busy, setBusy] = useState<string | null>(null);
    const { confirm } = useConfirmDialog();
    // Отмена и смена цены — через нижние шторки. Раньше это были 2-3 системных
    // окна браузера подряд (confirm → prompt «100/50/0» → prompt причины):
    // легко промахнуться, а во встроенных браузерах prompt молча не работает.
    const [cancelTarget, setCancelTarget] = useState<BookingHistoryItem | null>(null);
    const [priceTarget, setPriceTarget] = useState<BookingHistoryItem | null>(null);

    // Строка из обезличенного публичного расписания (/bookings/public: без
    // клиента и цены, «0 ₾» там ненастоящий) — по ней нельзя ни менять цену,
    // ни отменять. Админский /bookings всегда отдаёт user_id, так что пустой
    // userId = полные данные ещё не догрузились.
    const needsFullData = (b: BookingHistoryItem): boolean => {
        if (b.userId) return false;
        toast.error('Данные брони ещё загружаются — попробуйте через пару секунд');
        fetchAllBookings();
        return true;
    };

    const doCancel = (b: BookingHistoryItem) => {
        if (needsFullData(b)) return;
        setCancelTarget(b);
    };

    const performCancel = async (b: BookingHistoryItem, refundPercent: number, reason: string) => {
        setBusy(b.id);
        try {
            // Бэк ждёт ДОЛЮ 0..1 (1.0 = полный возврат), а UI собирает
            // проценты 100/50/0 → конвертируем. Без этого было
            // «refund_percent must be between 0 and 1» и отмена падала.
            await bookingsApi.cancelBooking(b.id, { refundPercent: refundPercent / 100, reason: reason || undefined });
            await fetchAllBookings();
            toast.success(
                refundPercent === 100 ? 'Отменена (полный возврат)'
                : refundPercent === 50 ? 'Отменена (возврат 50%)'
                : 'Отменена (без возврата)'
            );
            setCancelTarget(null);
            onClose();
        } catch (e: any) {
            toastApiError(e, 'Не удалось отменить');
        } finally {
            setBusy(null);
        }
    };

    const doEditPrice = (b: BookingHistoryItem) => {
        if (needsFullData(b)) return;
        setPriceTarget(b);
    };

    const performEditPrice = async (b: BookingHistoryItem, num: number, reason: string) => {
        const current = b.finalPrice ?? 0;
        setBusy(b.id);
        try {
            await bookingsApi.setPrice(b.id, num, reason || undefined);
            await fetchAllBookings();
            onChanged?.();
            toast.success(`Цена обновлена: ${formatGel(current)} → ${formatGel(num)}`);
            setPriceTarget(null);
            onClose();
        } catch (e: any) {
            toastApiError(e, 'Не удалось изменить цену');
        } finally {
            setBusy(null);
        }
    };

    const doApprove = async (b: BookingHistoryItem) => {
        setBusy(b.id);
        try {
            const res = await bookingsApi.approveBooking(b.id);
            await fetchAllBookings();
            onChanged?.();
            toast.success(res.approvalNote || 'Одобрено');
            onClose();
        } catch (e: any) {
            toastApiError(e, 'Не удалось одобрить');
        } finally {
            setBusy(null);
        }
    };

    const doReschedule = (b: BookingHistoryItem) => {
        onClose();
        navigate(`/m/find?reschedule=${b.id}&admin=1`);
    };

    const doExtend = async (b: BookingHistoryItem) => {
        const ok = await confirm({
            title: 'Добавить 30 минут?',
            body: 'Бронь станет длиннее на 30 минут, цену пересчитаем.',
            confirmLabel: 'Добавить 30 минут',
            cancelLabel: 'Не добавлять',
        });
        if (!ok) return;
        setBusy(b.id);
        try {
            await bookingsApi.extendBooking(b.id, 30);
            await fetchAllBookings();
            onChanged?.();
            toast.success('Добавлено 30 минут');
            onClose();
        } catch (e: any) {
            toastApiError(e, 'Не удалось добавить время');
        } finally {
            setBusy(null);
        }
    };

    const doToggleReRent = async (b: BookingHistoryItem) => {
        // Как на компьютере: выставить на пересдачу — только после вопроса (UX 24.10).
        if (!b.isReRentListed && !(await confirm({
            title: 'Пересдать бронь?',
            body: 'Время увидят другие. Если его займут, эту бронь отменим и вернём клиенту 50%.',
            confirmLabel: 'Пересдать',
            cancelLabel: 'Не пересдавать',
        }))) return;
        setBusy(b.id);
        try {
            const updated = await bookingsApi.toggleReRent(b.id);
            await fetchAllBookings();
            onChanged?.();
            toast.success(updated.isReRentListed
                ? 'Бронь выставлена на пересдачу'
                : 'Бронь снята с пересдачи');
            onClose();
        } catch (e: any) {
            toastApiError(e, 'Не удалось обновить статус');
        } finally {
            setBusy(null);
        }
    };

    return (
        <>
            {booking && (
                <ActionSheet
                    booking={booking}
                    userName={getUserName(booking.userId)}
                    resourceName={RESOURCES.find(r => r.id === booking.resourceId)?.name || booking.resourceId || ''}
                    busy={busy === booking.id}
                    onClose={onClose}
                    onCancel={() => doCancel(booking)}
                    onApprove={() => doApprove(booking)}
                    onReschedule={() => doReschedule(booking)}
                    onToggleReRent={() => doToggleReRent(booking)}
                    onEditPrice={() => doEditPrice(booking)}
                    onExtend={() => doExtend(booking)}
                    onOpenUser={() => navigate(`/m/admin/users/${encodeURIComponent(booking.userId)}`)}
                    pay={canCash && acceptPayment ? acceptPayment(booking) : null}
                    dueInfo={dueInfo}
                    rebateNote={rebateOf(booking) > 0 ? weeklyRebateNote(rebateOf(booking)) : null}
                />
            )}

            {cancelTarget && (
                <CancelBookingSheet
                    booking={cancelTarget}
                    userName={getUserName(cancelTarget.userId)}
                    busy={busy === cancelTarget.id}
                    isOwner={isOwner}
                    onClose={() => setCancelTarget(null)}
                    onConfirm={(pct, reason) => { void performCancel(cancelTarget, pct, reason).then(() => onChanged?.()); }}
                />
            )}

            {priceTarget && (
                <EditPriceSheet
                    booking={priceTarget}
                    userName={getUserName(priceTarget.userId)}
                    busy={busy === priceTarget.id}
                    onClose={() => setPriceTarget(null)}
                    onConfirm={(num, reason) => performEditPrice(priceTarget, num, reason)}
                />
            )}
        </>
    );
}

/** Почему цена такая («почему 18 ₾, а не 20?» — owner 2026-05-25). Было
 *  только в шторке дашборда, теперь в общей. null — скидки нет. */
function discountNote(b: BookingHistoryItem): string | null {
    if (b.appliedRule === 'SUBSCRIPTION') return 'По абонементу';
    if (!b.appliedRule || b.appliedRule === 'NONE') return null;
    if (!b.discountPercent && !b.discountAmount) return null;
    // «−0 %» не пишем (ручная цена выше цены движка — скидки нет), ревизия 04.10
    const pct = b.discountPercent ?? 0;
    return `${discountLabel(b.appliedRule)}${pct > 0 ? ` · −${pct}%` : ''} (база ${formatGel(b.basePrice ?? b.finalPrice)})`;
}

function discountLabel(rule: string | undefined | null): string {
    switch (rule) {
        case 'PERSONAL_DISCOUNT':     return 'Личная скидка';
        case 'WEEKLY_PROGRESSIVE':    return 'Недельная (накопленные часы)';
        case 'CONSECUTIVE_HOURS':     return 'За длительность брони';
        case 'MANUAL_OVERRIDE':       return 'Ручная корректировка';
        case 'BONUS_HOUR':            return 'Час в подарок';
        case 'BONUS_HOUR_PART':       return 'Час в подарок (часть брони)';
        case 'SUBSCRIPTION':          return 'Абонемент';
        case 'SUBSCRIPTION_DISCOUNT': return 'Скидка по абонементу';
        case 'HOT_BOOKING':           return 'Горячая бронь';
        default:                      return 'Скидка';
    }
}

/** Standalone duration formatter (используется ActionSheet — он отдельный
 *  компонент за пределами замыкания родителя). */
function formatDurationStandalone(min: number): string {
    if (min < 60) return `${min} мин`;
    const h = Math.floor(min / 60);
    const m = min % 60;
    if (m === 0) return `${h} ч`;
    if (m === 30) return `${h},5 ч`;
    return `${h} ч ${m} мин`;
}

function ActionSheet({
    booking, userName, resourceName, busy, onClose, onCancel, onApprove, onReschedule, onToggleReRent, onEditPrice, onExtend, onOpenUser, pay, rebateNote, dueInfo,
}: {
    booking: BookingHistoryItem;
    userName: string;
    resourceName: string;
    busy: boolean;
    onClose: () => void;
    onCancel: () => void;
    onApprove: () => void;
    onReschedule: () => void;
    onToggleReRent: () => void;
    onEditPrice: () => void;
    onExtend: () => void;
    onOpenUser: () => void;
    pay?: { sub: string; onClick: () => void; total?: number } | null;
    /** «скидка за прошлую неделю +9 ₾ уже учтена в «к оплате»» — если была. */
    rebateNote?: string | null;
    dueInfo?: DueInfo;
}) {
    const canCancel = booking.status === 'confirmed' || booking.status === 'pending_approval';
    const canApprove = booking.status === 'pending_approval';
    // Reschedule / re-rent — только для активных будущих броней.
    // Прошедшие/отменённые не имеет смысла переносить.
    const isActive = booking.status === 'confirmed' || booking.status === 'pending_approval';
    const isFuture = (() => {
        try {
            const d = new Date(booking.date as any);
            const [h, m] = (booking.startTime || '00:00').split(':').map(Number);
            d.setHours(h, m, 0, 0);
            return d.getTime() > Date.now();
        } catch { return false; }
    })();
    const canReschedule = isActive && isFuture;
    const isReRented = (booking as any).isReRentListed === true;
    // 09.11 (владелец): пересдача — только если до начала меньше суток. Раньше —
    // обычная отмена с полным возвратом; снять старую пересдачу можно всегда.
    const hoursLeft = hoursUntilStart(booking as any);
    const reRentWindow = hoursLeft !== null && hoursLeft < 24;
    const canReRent = isActive && isFuture && (reRentWindow || isReRented);
    const reRentTooEarly = isActive && isFuture && !reRentWindow && !isReRented;
    // «Продлить» — будущие, а также СЕГОДНЯШНИЕ прошедшие: клиент занимался
    // дольше заказанного, админ доводит время по факту в тот же день. Бэкенд
    // тоже разрешает добор только сегодняшним прошедшим (для админа).
    const isToday = (() => {
        try {
            const d = new Date(booking.date as any);
            const n = new Date();
            return d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate();
        } catch { return false; }
    })();
    const canExtend = isActive && (isFuture || isToday);
    const discount = discountNote(booking);
    const priceLabel = booking.finalPrice > 0 ? ` · ${formatGel(booking.finalPrice)}` : '';
    return (
        <Sheet
            open
            onClose={onClose}
            title={userName}
            description={`${formatDayMonth(booking.date as any)}, ${booking.startTime} · ${resourceName} · ${formatDurationStandalone(booking.duration ?? 60)}${priceLabel}`}
        >
                {/* Главное — оплата (admin-design №20): та же метка, что в строке, и цена. */}
                <div data-sheet-payment style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', margin: '0 0 12px' }}>
                    {booking.status === 'pending_approval'
                        ? <span className="ui-badge ui-badge--pending">{statusLabel('booking', 'pending_approval', 'staff')}</span>
                        : <DueBadge due={dueInfo?.due} paid={!!dueInfo} charged={dueInfo?.charged} price={dueInfo?.price}
                            status={booking.status} method={booking.paymentMethod as string | undefined} />}
                    <span style={{ fontSize: 14, color: 'var(--color-ink-60)' }}>
                        Цена <span className="num" style={{ fontWeight: 600, color: 'var(--color-ink)' }}>{formatGel(booking.finalPrice ?? 0)}</span>
                    </span>
                </div>
                {discount && (
                    <p style={{ fontSize: 14, color: 'var(--color-ink-60)', margin: '0 0 12px' }}>
                        {discount}
                    </p>
                )}
                {rebateNote && (
                    <p data-weekly-rebate-note style={{ fontSize: 14, color: 'var(--status-ok-fg)', margin: '0 0 12px' }}>
                        {rebateNote}
                    </p>
                )}

                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {canApprove && (
                        <ActionRow
                            label="Одобрить бронь"
                            tone="ok"
                            icon={<Check size={18} />}
                            busy={busy}
                            onClick={onApprove}
                        />
                    )}
                    {pay && (
                        <ActionRow
                            label={pay.total && pay.total > 0 ? `Принять оплату · ${formatGel(pay.total)}` : 'Принять оплату'}
                            sub={pay.sub}
                            tone="danger"
                            icon={<Wallet size={18} />}
                            onClick={pay.onClick}
                        />
                    )}
                    {canReschedule && (
                        <ActionRow
                            label="Перенести бронь"
                            sub="Выбрать новый слот"
                            icon={<CalendarClock size={18} />}
                            onClick={onReschedule}
                        />
                    )}
                    {canExtend && (
                        <ActionRow
                            label="Добавить 30 минут"
                            sub={isFuture ? 'Продлить бронь' : 'Клиент занимался дольше — добить по факту'}
                            icon={<Plus size={18} />}
                            busy={busy}
                            onClick={onExtend}
                        />
                    )}
                    {canReRent && (
                        <ActionRow
                            label={isReRented ? 'Снять с пересдачи' : 'Пересдать'}
                            sub={isReRented
                                ? 'Бронь снова станет личной'
                                : 'Если кто-то заберёт — 50% вернётся клиенту'}
                            tone={isReRented ? 'ok' : undefined}
                            icon={<Repeat size={18} />}
                            busy={busy}
                            onClick={onToggleReRent}
                        />
                    )}
                    {reRentTooEarly && (
                        <div style={{ fontSize: 13, color: 'var(--color-ink-60)', padding: '4px 4px 8px' }}>
                            Больше суток до начала — пересдавать не нужно: отмените бронь, деньги вернутся полностью.
                        </div>
                    )}
                    {isActive && (
                        <ActionRow
                            label="Изменить цену"
                            sub={`Сейчас ${formatGel(booking.finalPrice ?? 0)}`}
                            icon={<Banknote size={18} />}
                            busy={busy}
                            onClick={onEditPrice}
                        />
                    )}
                    <ActionRow
                        label="Открыть карточку клиента"
                        icon={<UserRound size={18} />}
                        onClick={onOpenUser}
                    />
                    {canCancel && (
                        <ActionRow
                            label="Отменить бронь"
                            tone="danger"
                            icon={<X size={18} />}
                            busy={busy}
                            onClick={onCancel}
                        />
                    )}
                </div>
        </Sheet>
    );
}

function ActionRow({
    label, sub, icon, tone, busy, onClick,
}: { label: string; sub?: string; icon: React.ReactNode; tone?: 'ok' | 'danger'; busy?: boolean; onClick: () => void }) {
    const bgVar = tone === 'danger' ? '--status-danger-bg'
        : tone === 'ok' ? '--status-ok-bg'
        : '--color-sunken';
    const fgVar = tone === 'danger' ? '--status-danger-fg'
        : tone === 'ok' ? '--status-ok-fg'
        : '--color-ink';
    return (
        <button
            onClick={onClick}
            disabled={busy}
            aria-busy={busy || undefined}
            className="press"
            style={{
                display: 'flex', alignItems: 'center', gap: 10,
                background: `var(${bgVar})`,
                color: `var(${fgVar})`,
                border: 'none', borderRadius: 12,
                padding: '12px 16px', fontFamily: 'inherit',
                fontSize: 15, fontWeight: 600, cursor: busy ? 'wait' : 'pointer',
                opacity: busy ? 0.6 : 1, textAlign: 'left',
                minHeight: 52,
            }}
        >
            {busy ? <Loader2 size={18} className="animate-spin-fast" style={{ flexShrink: 0 }} /> : <span style={{ flexShrink: 0 }}>{icon}</span>}
            <span style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0, flex: 1 }}>
                <span>{label}</span>
                {sub && <span style={{ fontSize: 12, fontWeight: 400 }}>{sub}</span>}
            </span>
        </button>
    );
}


// ─── Шторки поверх шторки действий: отмена брони и смена цены ───────────────

/** Минимум символов причины для сотрудника (не владельца) при отмене меньше чем за 24 ч — как на сервере. */
const LATE_REASON_MIN = 5;

function CancelBookingSheet({ booking, userName, busy, isOwner, onClose, onConfirm }: {
    booking: BookingHistoryItem; userName: string; busy: boolean; isOwner: boolean;
    onClose: () => void; onConfirm: (refundPercent: number, reason: string) => void;
}) {
    // Ревью 09.11 (№8): процент возврата заранее НЕ выбран — раньше стояло 100 %,
    // и одно нажатие отдавало клиенту всё (поздняя отмена, неявка — деньги центра).
    const isRequest = booking.status === 'pending_approval';
    const [pct, setPct] = useState<number | null>(isRequest ? 100 : null);
    const [reason, setReason] = useState('');
    const hours = hoursUntilStart(booking);
    // Меньше суток до начала или уже началась/прошла — по правилам клиент сам не отменит.
    const late = !isRequest && hours !== null && hours < 24;
    // 09.11 (владелец): сотрудник не-владелец отменяет «в обход правил» — только с
    // причиной (≥ 5 символов, сервер иначе 400); владелец получит уведомление.
    const lateNeedsReason = late && !isOwner;
    const reasonMin = lateNeedsReason ? LATE_REASON_MIN : (pct !== null && pct !== 100 ? 1 : 0);
    const reasonOk = reason.trim().length >= reasonMin;
    const showReason = lateNeedsReason || (pct !== null && pct !== 100);
    const preview = pct !== null ? refundPreview(booking, pct / 100, formatGel) : '';
    const cta = pct === null
        ? 'Выберите, сколько вернуть'
        : preview.startsWith('вернём ')
            ? `Отменить и ${preview.replace(/^вернём/, 'вернуть')}`
            : pct === 0 ? 'Отменить без возврата' : 'Отменить бронь';
    return (
        <Sheet
            open
            onClose={onClose}
            title="Отменить бронь"
            description={`${formatDayMonth(booking.date as any)}, ${booking.startTime} · ${userName}`}
            footer={
                <>
                    <Button
                        variant="danger"
                        block
                        loading={busy}
                        disabled={pct === null || !reasonOk}
                        onClick={() => { if (pct !== null) onConfirm(pct, reason.trim()); }}
                    >
                        {cta}
                    </Button>
                    {pct !== null && !reasonOk && (
                        <div style={{ fontSize: 12, color: 'var(--color-ink-60)', textAlign: 'center' }}>
                            {lateNeedsReason ? `Напишите причину — не короче ${LATE_REASON_MIN} символов` : 'Напишите причину'}
                        </div>
                    )}
                    <Button variant="secondary" block disabled={busy} onClick={onClose}>
                        Оставить бронь
                    </Button>
                </>
            }
        >
            {isRequest ? (
                <p style={{ fontSize: 14, color: 'var(--color-ink-80)', margin: 0 }}>
                    Это заявка «{statusLabel('booking', 'pending_approval', 'staff')}»: денег ещё не брали, возвращать нечего.
                </p>
            ) : (
                <>
                    {late && (
                        <div data-late-cancel style={{ fontSize: 14, color: 'var(--status-pending-fg)', background: 'var(--status-pending-bg)', borderRadius: 12, padding: '8px 12px', marginBottom: 12, lineHeight: 1.4 }}>
                            {hours !== null && hours < 0 ? 'Бронь уже началась или прошла.' : 'До начала меньше 24 часов.'}
                            {' '}По правилам клиент сам уже не отменит — без возврата. Если время пересдать и его займут — клиенту 50 %.
                        </div>
                    )}
                    <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 8, color: 'var(--color-ink)' }}>Сколько вернуть клиенту</div>
                    <div role="radiogroup" aria-label="Сколько вернуть клиенту" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        {[100, 50, 0].map(v => {
                            const selected = pct === v;
                            return (
                                <button
                                    key={v}
                                    type="button"
                                    role="radio"
                                    aria-checked={selected}
                                    onClick={() => setPct(v)}
                                    className="press"
                                    style={{
                                        display: 'flex', alignItems: 'center', gap: 10, minHeight: 52, padding: '8px 12px',
                                        borderRadius: 12, cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left',
                                        background: selected ? 'var(--color-accent-soft)' : 'var(--color-card)',
                                        border: selected ? '1px solid var(--color-accent)' : '1px solid var(--color-ink-10)',
                                        color: 'var(--color-ink)',
                                    }}
                                >
                                    <span style={{ fontSize: 16, fontWeight: 600, minWidth: 48 }} className="num">{v} %</span>
                                    <span style={{ fontSize: 14, color: 'var(--color-ink-80)' }}>
                                        {refundPreview(booking, v / 100, formatGel)}
                                        {late && v === 0 ? ' · по правилам' : ''}
                                    </span>
                                </button>
                            );
                        })}
                    </div>
                </>
            )}
            {showReason && (
                <div style={{ marginTop: 16 }}>
                    <Field
                        label={lateNeedsReason ? 'Причина (увидит владелец)' : 'Причина — видна в истории брони'}
                        hint={lateNeedsReason ? 'До начала меньше 24 часов — клиент так отменить не может. Владелец получит уведомление' : undefined}
                    >
                        <Input
                            value={reason}
                            onChange={e => setReason(e.target.value)}
                            placeholder="Например: неявка без предупреждения"
                        />
                    </Field>
                </div>
            )}
        </Sheet>
    );
}

function EditPriceSheet({ booking, userName, busy, onClose, onConfirm }: {
    booking: BookingHistoryItem; userName: string; busy: boolean;
    onClose: () => void; onConfirm: (price: number, reason: string) => void;
}) {
    const current = booking.finalPrice ?? 0;
    const [raw, setRaw] = useState(String(current));
    const [reason, setReason] = useState('');
    // Общий разбор суммы: «1 280,50» → 1280.5, «12abc» → null (ошибка под полем).
    const num = parseMoneyInput(raw);
    const valid = num !== null && num !== current;
    const priceError = !isMoneyInputBlank(raw) && num === null ? MONEY_INPUT_ERROR : undefined;
    // Ревью 09.11 (№9): 0 ₾ или снижение больше чем на половину — только с причиной
    // (чек-лист смены: «Цену 0 ₾ и ручную правку баланса — только с причиной»).
    const needReason = valid && num !== null && (num === 0 || num < current * 0.5);
    const reasonOk = !needReason || reason.trim().length > 0;
    return (
        <Sheet
            open
            onClose={onClose}
            title="Изменить цену"
            description={`${formatDayMonth(booking.date as any)}, ${booking.startTime} · ${userName} · сейчас ${formatGel(current)}`}
            footer={
                <>
                    <Button block loading={busy} disabled={!valid || !reasonOk} onClick={() => { if (num !== null && reasonOk) onConfirm(num, reason.trim()); }}>
                        {valid ? `Сохранить ${formatGel(num)} (было ${formatGel(current)})` : 'Сохранить'}
                    </Button>
                    {valid && !reasonOk && (
                        <div style={{ fontSize: 12, color: 'var(--color-ink-60)', textAlign: 'center' }}>
                            {num === 0 ? 'Напишите, почему бесплатно' : 'Напишите, почему цена ниже больше чем вдвое'}
                        </div>
                    )}
                    <Button variant="secondary" block disabled={busy} onClick={onClose}>
                        Не менять
                    </Button>
                </>
            }
        >
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <Field label="Новая цена" error={priceError}>
                    <Input kind="money" suffix="₾" value={raw} onChange={e => setRaw(e.target.value)} />
                </Field>
                <Field label="Причина" optional={!needReason}>
                    <Input value={reason} onChange={e => setReason(e.target.value)} placeholder={num === 0 ? 'Почему бесплатно?' : 'Например: скидка по договорённости'} />
                </Field>
            </div>
        </Sheet>
    );
}
