import { Link } from 'react-router-dom';
import { Sheet } from '../ui/Sheet';
import { Button } from '../ui/Button';
import { formatDateLabel, formatGel } from '../../utils/format';
import type { MaintenanceConflict } from '../../api/maintenance';
import { statusLabel } from '../../design/statuses';

/**
 * MaintenanceConflictSheet — «Закрыть кабинет» упёрся в брони (волна 4, шаг 0).
 *
 * Решение владельца В1 (01.10): блокировку поверх брони клиента не ставим.
 * Сервер отвечает 409 со списком (maintenanceApi.create бросает
 * MaintenanceConflictError) — экран показывает эту шторку. Отсюда ничего не
 * отменяем и не переносим: брони двигают обычными окнами, ссылка на каждую —
 * из пропа linkFor (у телефона и компьютера разные адреса).
 *
 *   } catch (e) {
 *     if (isMaintenanceConflict(e)) setConflicts(e.conflicts);
 *     else toastApiError(e, 'Не удалось закрыть кабинет');
 *   }
 *   <MaintenanceConflictSheet open={!!conflicts} conflicts={conflicts ?? []}
 *       onClose={() => setConflicts(null)}
 *       linkFor={c => `/admin/bookings?booking=${c.bookingId}`} />
 */
export interface MaintenanceConflictSheetProps {
    open: boolean;
    onClose: () => void;
    conflicts: MaintenanceConflict[];
    /** Адрес брони (откроется по ссылке в строке). */
    linkFor: (booking: MaintenanceConflict) => string;
    /** Название кабинета по id — если блок ставили на несколько кабинетов. */
    resourceName?: (resourceId: string) => string;
}

function endTime(start: string, duration: number): string {
    const [h, m] = start.split(':').map(Number);
    if (!Number.isFinite(h) || !Number.isFinite(m)) return '';
    const total = h * 60 + m + (duration || 0);
    return `${String(Math.floor(total / 60) % 24).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

/**
 * Деньги брони из конфликта — нейтрально, без «оплачено» / «к оплате».
 *
 * payment_status = 'paid' значит только «списана с баланса», а не «клиент
 * заплатил»: при минусе на балансе «Сегодня» и шахматка у той же брони
 * честно пишут «к оплате 7 ₾» (dueMap — computeDueByBooking по балансу).
 * Карты dueMap здесь нет (шторку открывают «Обслуживание» и «Кабинеты»,
 * которые брони и баланс не грузят), поэтому отметку оплаты не рисуем —
 * только цену и что с ней сделал сервер. Узнать, должен ли клиент, — по
 * ссылке на бронь.
 */
function PaymentNote({ c }: { c: MaintenanceConflict }) {
    const st = c.paymentStatus;
    const what = st === 'paid' ? 'списана с баланса'
        : st ? statusLabel('payment', st, 'staff').toLowerCase() : '';
    const text = st === 'waived' || !(c.finalPrice > 0)
        ? statusLabel('payment', 'waived', 'staff').toLowerCase()
        : `${formatGel(c.finalPrice)}${what ? ` · ${what}` : ''}`;
    return (
        <span className="num" data-conflict-payment style={{ fontSize: 'var(--text-small)', color: 'var(--color-ink-60)', whiteSpace: 'nowrap' }}>
            {text}
        </span>
    );
}

export function MaintenanceConflictSheet({ open, onClose, conflicts, linkFor, resourceName }: MaintenanceConflictSheetProps) {
    const n = conflicts.length;
    const multiRoom = new Set(conflicts.map(c => c.resourceId)).size > 1;
    return (
        <Sheet
            open={open}
            onClose={onClose}
            title="Кабинет не закрыт"
            description="В это время есть брони — сначала перенесите или отмените их"
            width={520}
            role="alertdialog"
            footer={<Button block onClick={onClose}>Понятно</Button>}
        >
            <ul style={{ listStyle: 'none', margin: 0, padding: 0 }} aria-label={`Брони в это время: ${n}`}>
                {conflicts.map(c => {
                    const who = c.client.name || c.client.email || 'Клиент';
                    const end = endTime(c.startTime, c.duration);
                    return (
                        <li
                            key={c.bookingId}
                            style={{
                                display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
                                padding: '12px 0', borderBottom: '1px solid var(--color-ink-10)',
                            }}
                        >
                            <div style={{ flex: '1 1 180px', minWidth: 0 }}>
                                <div style={{ fontWeight: 500 }}>
                                    {formatDateLabel(c.date, { capitalize: true, withYear: 'auto' })}
                                    {', '}
                                    <span className="num">{c.startTime}{end ? `–${end}` : ''}</span>
                                </div>
                                <div style={{ fontSize: 'var(--text-small)', color: 'var(--color-ink-60)', overflowWrap: 'anywhere' }}>
                                    <Link to={linkFor(c)} onClick={onClose} style={{ color: 'var(--color-accent-ink)' }}>
                                        {who}
                                    </Link>
                                    {multiRoom && resourceName ? ` · ${resourceName(c.resourceId)}` : ''}
                                </div>
                            </div>
                            <PaymentNote c={c} />
                        </li>
                    );
                })}
            </ul>
        </Sheet>
    );
}
