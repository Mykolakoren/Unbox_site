import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, Check, X, Loader2, CalendarClock, Repeat, DollarSign, Plus } from 'lucide-react';
import { format as fmtDate } from 'date-fns';
import { ru } from 'date-fns/locale';
import { toast } from 'sonner';
import { useUserStore } from '../../../store/userStore';
import { bookingsApi } from '../../../api/bookings';
import { RESOURCES } from '../../../utils/data';
import type { BookingHistoryItem, User } from '../../../store/types';
import { Z_SHEET, Z_SHEET_OVER_SHEET } from './sheetLayers';

/**
 * Шторки брони мобильной админки — ОДНИ на «Брони» и на «Дашборд».
 *
 * Раньше у дашборда была своя шторка: брала обезличенное публичное
 * расписание (ни клиента, ни цены), показывала «0 ₾», кнопка «Цена» с ходу
 * подставляла 0 (сохранишь — клиенту вернётся вся сумма), а «Удалить»
 * всегда возвращала 100% без выбора. Теперь оба экрана открывают одно и то
 * же: действия → отмена с выбором 100/50/0 → смена цены от настоящей.
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
            toast.success(`Цена обновлена: ${current.toFixed(0)} → ${num.toFixed(0)} ₾`);
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
        if (!window.confirm('Добавить 30 минут к этой брони? Цена пересчитается.')) return;
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
                ? 'Выставлено на переаренду'
                : 'Снято с переаренды');
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
    return `${discountLabel(b.appliedRule)} · −${b.discountPercent ?? 0}% (база ${b.basePrice ?? b.finalPrice} ₾)`;
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
        default:                      return rule || '';
    }
}

/** Standalone duration formatter (используется ActionSheet — он отдельный
 *  компонент за пределами замыкания родителя). */
function formatDurationStandalone(min: number): string {
    if (min < 60) return `${min} мин`;
    const h = Math.floor(min / 60);
    const m = min % 60;
    if (m === 0) return `${h} ч`;
    if (m === 30) return `${h}.5 ч`;
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
    return (
        <div
            onClick={onClose}
            role="dialog"
            aria-modal="true"
            style={{
                position: 'fixed', inset: 0,
                background: 'rgba(14,14,14,0.55)', zIndex: Z_SHEET,
                display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
            }}
        >
            <div
                onClick={e => e.stopPropagation()}
                style={{
                    width: '100%', maxWidth: 480, background: 'var(--color-paper)',
                    borderRadius: '20px 20px 0 0',
                    padding: 20,
                    paddingBottom: 'calc(20px + env(safe-area-inset-bottom, 0px))',
                    display: 'flex', flexDirection: 'column', gap: 14,
                    // Когда действий много, содержимое не помещается и нижняя
                    // кнопка («Отменить») уходила под тулбар Safari. dvh учитывает
                    // адресную строку/тулбар, внутренний скролл поднимает контент.
                    maxHeight: 'calc(100dvh - 16px)',
                    overflowY: 'auto',
                    WebkitOverflowScrolling: 'touch',
                }}
            >
                <div>
                    <div style={{
                        fontSize: 11, fontWeight: 700, color: 'var(--color-ink-40)',
                        letterSpacing: '0.08em', textTransform: 'uppercase',
                    }}>
                        {fmtDate(new Date(booking.date as any), 'd MMMM', { locale: ru })} · {booking.startTime}
                    </div>
                    <div style={{ fontSize: 19, fontWeight: 800, marginTop: 4, color: 'var(--color-ink)' }}>
                        {userName}
                    </div>
                    <div style={{ fontSize: 13, color: 'var(--color-ink-60)', marginTop: 4 }}>
                        {resourceName} · {formatDurationStandalone(booking.duration ?? 60)}
                        {booking.finalPrice > 0 && ` · ${booking.finalPrice} ₾`}
                    </div>
                    {discount && (
                        <div style={{ fontSize: 12, color: 'var(--color-ink-60)', marginTop: 2 }}>
                            {discount}
                        </div>
                    )}
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
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
                            label={isReRented ? 'Снять с переаренды' : 'Выставить на переаренду'}
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
                            sub={`Текущая: ${(booking.finalPrice ?? 0).toFixed(0)} ₾`}
                            icon={<DollarSign size={18} />}
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
            </div>
        </div>
    );
}

function ActionRow({
    label, sub, icon, tone, busy, onClick,
}: { label: string; sub?: string; icon: React.ReactNode; tone?: 'ok' | 'danger'; busy?: boolean; onClick: () => void }) {
    const bgVar = tone === 'danger' ? '--status-danger-bg'
        : tone === 'ok' ? '--status-ok-bg'
        : '--color-surface';
    const fgVar = tone === 'danger' ? '--status-danger-solid'
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
                fontSize: 15, fontWeight: 700, cursor: busy ? 'wait' : 'pointer',
                opacity: busy ? 0.6 : 1, textAlign: 'left',
                minHeight: 52,
            }}
        >
            {busy ? <Loader2 size={18} className="animate-spin-fast" style={{ flexShrink: 0 }} /> : <span style={{ flexShrink: 0 }}>{icon}</span>}
            <span style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0, flex: 1 }}>
                <span>{label}</span>
                {sub && <span style={{ fontSize: 11, fontWeight: 500, opacity: 0.75 }}>{sub}</span>}
            </span>
        </button>
    );
}


// ─── Нижние шторки: отмена брони и смена цены ────────────────────────────────

function BottomSheet({ onClose, children }: { onClose: () => void; children: React.ReactNode }) {
    return (
        <div
            onClick={onClose}
            role="dialog"
            aria-modal="true"
            style={{
                position: 'fixed', inset: 0,
                background: 'rgba(14,14,14,0.55)', zIndex: Z_SHEET_OVER_SHEET,
                display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
            }}
        >
            <div
                onClick={e => e.stopPropagation()}
                style={{
                    width: '100%', maxWidth: 480, background: 'var(--color-paper)',
                    borderRadius: '20px 20px 0 0',
                    padding: 20,
                    paddingBottom: 'calc(20px + env(safe-area-inset-bottom, 0px))',
                    display: 'flex', flexDirection: 'column', gap: 14,
                    maxHeight: 'calc(100dvh - 16px)', overflowY: 'auto',
                }}
            >
                {children}
            </div>
        </div>
    );
}

const sheetInput: React.CSSProperties = {
    width: '100%', padding: '12px 14px', fontSize: 16, fontFamily: 'inherit',
    border: '1px solid var(--color-ink-20, rgba(0,0,0,0.2))', borderRadius: 12,
    background: '#fff', color: 'var(--color-ink)', boxSizing: 'border-box',
};

function SheetButtons({ confirmLabel, danger, disabled, busy, onConfirm, onClose }: {
    confirmLabel: string; danger?: boolean; disabled?: boolean; busy: boolean; onConfirm: () => void; onClose: () => void;
}) {
    return (
        <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
            <button
                onClick={onClose}
                disabled={busy}
                style={{ flex: 1, minHeight: 48, borderRadius: 12, border: '1px solid rgba(0,0,0,0.15)', background: 'transparent', fontSize: 15, fontWeight: 600, fontFamily: 'inherit', color: 'var(--color-ink)' }}
            >
                Назад
            </button>
            <button
                onClick={onConfirm}
                disabled={busy || disabled}
                style={{
                    flex: 1.4, minHeight: 48, borderRadius: 12, border: 'none', fontSize: 15, fontWeight: 700, fontFamily: 'inherit',
                    background: danger ? '#C8253A' : '#0E0E0E', color: '#fff',
                    opacity: busy || disabled ? 0.45 : 1,
                }}
            >
                {busy ? 'Сохраняю…' : confirmLabel}
            </button>
        </div>
    );
}

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
        <BottomSheet onClose={onClose}>
            <div>
                <div style={{ fontSize: 19, fontWeight: 800, color: 'var(--color-ink)' }}>Отменить бронь</div>
                <div style={{ fontSize: 14, color: 'var(--color-ink-60)', marginTop: 4 }}>
                    {fmtDate(new Date(booking.date as any), 'd MMMM', { locale: ru })} · {booking.startTime} · {userName}
                </div>
            </div>
            <div>
                <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8, color: 'var(--color-ink)' }}>Сколько вернуть клиенту</div>
                <div style={{ display: 'flex', gap: 8 }}>
                    {[100, 50, 0].map(v => (
                        <button
                            key={v}
                            onClick={() => setPct(v)}
                            aria-pressed={pct === v}
                            style={{
                                flex: 1, minHeight: 48, borderRadius: 12, fontSize: 16, fontWeight: 700, fontFamily: 'inherit',
                                border: pct === v ? '2px solid #0E0E0E' : '1px solid rgba(0,0,0,0.15)',
                                background: pct === v ? '#0E0E0E' : 'transparent',
                                color: pct === v ? '#fff' : 'var(--color-ink)',
                            }}
                        >
                            {v}%
                        </button>
                    ))}
                </div>
                <div style={{ fontSize: 13, color: 'var(--color-ink-60)', marginTop: 8 }}>
                    {notCharged && <div style={{ marginBottom: 4 }}>Оплата за эту бронь ещё не списывалась — при любом варианте с клиента ничего не спишется.</div>}
                    {pct === 100 && 'Бесплатная отмена — клиенту вернётся всё списанное.'}
                    {pct === 50 && `Вернётся половина${price > 0 ? ` (≈ ${refund} ₾ из ${price} ₾)` : ''}.`}
                    {pct === 0 && 'Без возврата — например, клиент не пришёл.'}
                </div>
            </div>
            {needReason && (
                <label style={{ display: 'block' }}>
                    <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6, color: 'var(--color-ink)' }}>Причина — видна в истории брони</div>
                    <input
                        value={reason}
                        onChange={e => setReason(e.target.value)}
                        placeholder="Например: неявка без предупреждения"
                        style={sheetInput}
                    />
                </label>
            )}
            <SheetButtons
                confirmLabel="Отменить бронь"
                danger
                disabled={needReason && !reason.trim()}
                busy={busy}
                onClose={onClose}
                onConfirm={() => onConfirm(pct, reason.trim())}
            />
        </BottomSheet>
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
        <BottomSheet onClose={onClose}>
            <div>
                <div style={{ fontSize: 19, fontWeight: 800, color: 'var(--color-ink)' }}>Изменить цену</div>
                <div style={{ fontSize: 14, color: 'var(--color-ink-60)', marginTop: 4 }}>
                    {fmtDate(new Date(booking.date as any), 'd MMMM', { locale: ru })} · {booking.startTime} · {userName} · сейчас {current.toFixed(0)} ₾
                </div>
            </div>
            <label style={{ display: 'block' }}>
                <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6, color: 'var(--color-ink)' }}>Новая цена, ₾</div>
                <input value={raw} onChange={e => setRaw(e.target.value)} inputMode="decimal" style={sheetInput} />
            </label>
            <label style={{ display: 'block' }}>
                <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6, color: 'var(--color-ink)' }}>Причина</div>
                <input value={reason} onChange={e => setReason(e.target.value)} placeholder="Например: скидка по договорённости" style={sheetInput} />
            </label>
            <SheetButtons
                confirmLabel={valid ? `Сохранить ${num.toFixed(0)} ₾` : 'Сохранить'}
                disabled={!valid}
                busy={busy}
                onClose={onClose}
                onConfirm={() => onConfirm(num, reason.trim())}
            />
        </BottomSheet>
    );
}
