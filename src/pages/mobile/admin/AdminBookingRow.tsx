import type { ReactNode } from 'react';
import { Clock, Sparkles } from 'lucide-react';
import { ListRow, ListTime } from '../../../components/ui/ListRow';
import { statusLabel } from '../../../design/statuses';

/**
 * AdminBookingRow — ОДНА строка брони в мобильной админке (09.11, фаза 3):
 * «Сегодня», «Брони» и карточка клиента. Раньше та же бронь была нарисована
 * тремя способами (своя рамка у каждой строки, время 14/15 px, имя
 * обрезалось до «Ната…» на 360 px, две плашки справа).
 *
 * Собрана на общем ListRow: слева ListTime (начало 16/600, конец 12),
 * имя 16/600 ПЕРЕНОСИТСЯ (не режется), подпись «Кабинет 5 · Uni · 2 ч»,
 * справа ОДНА плашка (DueBadge — её рисует экран: метки решены в DueBadge).
 * Статус «Ждёт подтверждения» — словом в подписи (янтарный значок Clock)
 * и янтарной полосой слева; долг — красной полосой (tone="danger") вместе
 * со словом «к оплате» на плашке. Строки идут в одной ListGroup.
 *
 * Только вид: что считать «к оплате», решает dueMap экрана.
 */
export interface AdminBookingRowProps {
    start: ReactNode;
    end?: ReactNode;
    /** Имя клиента (или «уборка» у служебной брони). */
    name: ReactNode;
    /** «Кабинет 5 · Uni · 2 ч». */
    subtitle?: ReactNode;
    /** Статус брони: не confirmed — словом в подписи. */
    status?: string | null;
    /** Одна плашка справа: <DueBadge/> или «Блок». */
    badge?: ReactNode;
    /** Клиент из архива — метка рядом с именем. */
    archived?: boolean;
    /** Служебная бронь (уборка) — тише, со значком. */
    blocker?: boolean;
    /** Есть что взять — красная полоса слева. */
    owes?: boolean;
    /** Прошедшая/отменённая — название ink-60. */
    dimmed?: boolean;
    /** Ещё строка под подписью (недельная скидка и т.п.). */
    note?: ReactNode;
    onClick?: () => void;
    'aria-label'?: string;
}

export function AdminBookingRow({
    start, end, name, subtitle, status, badge, archived, blocker, owes, dimmed, note, onClick, ...aria
}: AdminBookingRowProps) {
    const pending = status === 'pending_approval';
    const statusWord = !blocker && status && status !== 'confirmed'
        ? statusLabel('booking', status, 'staff')
        : null;
    return (
        <ListRow
            lead={<ListTime start={start} end={end} />}
            title={
                <>
                    {blocker && <Sparkles size={14} aria-hidden="true" style={{ display: 'inline-block', color: 'var(--color-ink-60)', marginRight: 6, verticalAlign: '-2px' }} />}
                    <span style={blocker ? { textTransform: 'capitalize', fontWeight: 500 } : undefined}>{name}</span>
                    {archived && <span className="ui-badge ui-badge--muted" style={{ marginLeft: 8, verticalAlign: '2px' }}>архив</span>}
                </>
            }
            subtitle={(subtitle || statusWord) ? (
                <>
                    {subtitle}
                    {statusWord && (
                        pending ? (
                            // «Ждёт подтверждения» — своей строкой: значок не отрывается от слова.
                            <span
                                data-booking-status
                                style={{ display: 'flex', alignItems: 'center', gap: 4, color: 'var(--status-pending-fg)', fontWeight: 500 }}
                            >
                                <Clock size={12} aria-hidden="true" style={{ flexShrink: 0 }} />
                                {statusWord}
                            </span>
                        ) : (
                            <span data-booking-status style={{ whiteSpace: 'nowrap' }}>
                                {subtitle ? ' · ' : ''}{statusWord.toLowerCase()}
                            </span>
                        )
                    )}
                </>
            ) : undefined}
            meta={note}
            trail={badge}
            tone={owes ? 'danger' : pending ? 'pending' : undefined}
            toneLabel={owes ? 'к оплате' : undefined}
            dimmed={dimmed || blocker}
            onClick={onClick}
            chevron={false}
            aria-label={aria['aria-label']}
        />
    );
}
