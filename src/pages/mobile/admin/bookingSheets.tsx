import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, Check, X, Loader2, CalendarClock, Repeat, Banknote, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { useUserStore } from '../../../store/userStore';
import { bookingsApi } from '../../../api/bookings';
import { RESOURCES } from '../../../utils/data';
import type { BookingHistoryItem, User } from '../../../store/types';
import { Sheet } from '../../../components/ui/Sheet';
import { Button } from '../../../components/ui/Button';
import { Field, Input } from '../../../components/ui/Field';
import { Segmented } from '../../../components/ui/Chip';
import { useConfirmDialog } from '../../../components/ui/ConfirmDialogProvider';
import { formatDayMonth, formatGel } from '../../../utils/format';

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
export function AdminBookingSheets({ booking, getUserName, onClose }: {
    /** Бронь, по которой открыта шторка действий (null — закрыта). */
    booking: BookingHistoryItem | null;
    getUserName: (email: string | null | undefined) => string;
    onClose: () => void;
}) {
    const navigate = useNavigate();
    const fetchAllBookings = useUserStore(s => s.fetchAllBookings);
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
            toast.error(e?.response?.data?.detail || 'Не удалось отменить');
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
            toast.success(`Цена обновлена: ${formatGel(current)} → ${formatGel(num)}`);
            setPriceTarget(null);
            onClose();
        } catch (e: any) {
            toast.error(e?.response?.data?.detail || 'Не удалось изменить цену');
        } finally {
            setBusy(null);
        }
    };

    const doApprove = async (b: BookingHistoryItem) => {
        setBusy(b.id);
        try {
            await bookingsApi.approveBooking(b.id);
            await fetchAllBookings();
            toast.success('Одобрено');
            onClose();
        } catch (e: any) {
            toast.error(e?.response?.data?.detail || 'Не удалось одобрить');
        } finally {
            setBusy(null);
        }
    };

    const doReschedule = (b: BookingHistoryItem) => {
        onClose();
        navigate(`/m/find?reschedule=${b.id}`);
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
            toast.success('Добавлено 30 минут');
            onClose();
        } catch (e: any) {
            toast.error(e?.response?.data?.detail || 'Не удалось добавить время');
        } finally {
            setBusy(null);
        }
    };

    const doToggleReRent = async (b: BookingHistoryItem) => {
        setBusy(b.id);
        try {
            const updated = await bookingsApi.toggleReRent(b.id);
            await fetchAllBookings();
            toast.success(updated.isReRentListed
                ? 'Бронь выставлена на пересдачу'
                : 'Бронь снята с пересдачи');
            onClose();
        } catch (e: any) {
            toast.error(e?.response?.data?.detail || 'Не удалось обновить статус');
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
                />
            )}

            {cancelTarget && (
                <CancelBookingSheet
                    booking={cancelTarget}
                    userName={getUserName(cancelTarget.userId)}
                    busy={busy === cancelTarget.id}
                    onClose={() => setCancelTarget(null)}
                    onConfirm={(pct, reason) => performCancel(cancelTarget, pct, reason)}
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
    return `${discountLabel(b.appliedRule)} · −${b.discountPercent ?? 0}% (база ${formatGel(b.basePrice ?? b.finalPrice)})`;
}

function discountLabel(rule: string | undefined | null): string {
    switch (rule) {
        case 'PERSONAL_DISCOUNT':     return 'Личная скидка';
        case 'WEEKLY_PROGRESSIVE':    return 'Недельная (накопленные часы)';
        case 'CONSECUTIVE_HOURS':     return 'За длительность брони';
        case 'MANUAL_OVERRIDE':       return 'Ручная корректировка';
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
    booking, userName, resourceName, busy, onClose, onCancel, onApprove, onReschedule, onToggleReRent, onEditPrice, onExtend, onOpenUser,
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
    const canReRent = isActive && isFuture;
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
    const isReRented = (booking as any).isReRentListed === true;
    const discount = discountNote(booking);
    const priceLabel = booking.finalPrice > 0 ? ` · ${formatGel(booking.finalPrice)}` : '';
    return (
        <Sheet
            open
            onClose={onClose}
            title={userName}
            description={`${formatDayMonth(booking.date as any)}, ${booking.startTime} · ${resourceName} · ${formatDurationStandalone(booking.duration ?? 60)}${priceLabel}`}
        >
                {discount && (
                    <p style={{ fontSize: 14, color: 'var(--color-ink-60)', margin: '0 0 12px' }}>
                        {discount}
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
                        icon={<Search size={18} />}
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

function CancelBookingSheet({ booking, userName, busy, onClose, onConfirm }: {
    booking: BookingHistoryItem; userName: string; busy: boolean;
    onClose: () => void; onConfirm: (refundPercent: number, reason: string) => void;
}) {
    const [pct, setPct] = useState(100);
    const [reason, setReason] = useState('');
    const needReason = pct !== 100;
    const price = booking.finalPrice ?? 0;
    const refund = Math.round(price * pct) / 100;
    const notCharged = booking.paymentStatus === 'pending';
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
                        disabled={needReason && !reason.trim()}
                        onClick={() => onConfirm(pct, reason.trim())}
                    >
                        Отменить бронь
                    </Button>
                    <Button variant="secondary" block disabled={busy} onClick={onClose}>
                        Оставить бронь
                    </Button>
                </>
            }
        >
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 8, color: 'var(--color-ink)' }}>Сколько вернуть клиенту</div>
            <Segmented
                aria-label="Сколько вернуть клиенту"
                options={[100, 50, 0].map(v => ({ value: String(v), label: `${v}%` }))}
                value={String(pct)}
                onChange={v => setPct(Number(v))}
            />
            <div style={{ fontSize: 14, color: 'var(--color-ink-60)', marginTop: 8 }}>
                {notCharged && <div style={{ marginBottom: 4 }}>Оплата за эту бронь ещё не списывалась — при любом варианте с клиента ничего не спишется.</div>}
                {pct === 100 && 'Бесплатная отмена — клиенту вернётся всё списанное.'}
                {pct === 50 && `Вернётся половина${price > 0 ? ` (≈ ${formatGel(refund)} из ${formatGel(price)})` : ''}.`}
                {pct === 0 && 'Без возврата — например, клиент не пришёл.'}
            </div>
            {needReason && (
                <div style={{ marginTop: 16 }}>
                    <Field label="Причина — видна в истории брони">
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
    const num = parseFloat(raw.replace(',', '.'));
    const valid = Number.isFinite(num) && num >= 0 && num !== current;
    return (
        <Sheet
            open
            onClose={onClose}
            title="Изменить цену"
            description={`${formatDayMonth(booking.date as any)}, ${booking.startTime} · ${userName} · сейчас ${formatGel(current)}`}
            footer={
                <>
                    <Button block loading={busy} disabled={!valid} onClick={() => onConfirm(num, reason.trim())}>
                        {valid ? `Сохранить ${formatGel(num)}` : 'Сохранить'}
                    </Button>
                    <Button variant="secondary" block disabled={busy} onClick={onClose}>
                        Не менять
                    </Button>
                </>
            }
        >
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <Field label="Новая цена">
                    <Input kind="money" suffix="₾" value={raw} onChange={e => setRaw(e.target.value)} />
                </Field>
                <Field label="Причина" optional>
                    <Input value={reason} onChange={e => setReason(e.target.value)} placeholder="Например: скидка по договорённости" />
                </Field>
            </div>
        </Sheet>
    );
}
