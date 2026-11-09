import { useEffect, useMemo, useState } from 'react';
import { Gift, Clock, Check, Info, X } from 'lucide-react';
import { parseISO } from 'date-fns';
import { bonusesApi, type Bonus } from '../../api/bonuses';
import { TEXT } from '../../design/tokens';
import { formatDayMonth } from '../../utils/format';
import { ruPlural } from '../../utils/plural';
import { Skeleton, SkeletonList } from '../../components/ui/Skeleton';
import { ErrorBar } from '../../components/ui/ErrorBar';
import { EmptyState } from '../../components/ui/EmptyState';
import { Segmented } from '../../components/ui/Chip';
import { SummaryCard } from '../../components/ui/SummaryCard';
import { ListGroup, ListIcon, ListRow } from '../../components/ui/ListRow';
import { MobilePageHeader } from '../../components/ui/PageHeader';

// 09.11 фаза 3: три сегмента вместо четырёх чипов (переносились в две строки):
// «Прошлые» = использованные + истёкшие, у каждой строки — бирка.
type Filter = 'active' | 'past' | 'all';

/** Пусто — своя фраза для каждого фильтра. */
const EMPTY_TITLE: Record<Filter, string> = {
    active: 'Активных бонусов нет',
    past: 'Прошлых бонусов нет',
    all: 'Бонусов пока нет',
};

/**
 * Mobile cabinet: Бонусы — full bonus history with active/used/expired
 * filters. Replaces the cramped 5-item preview inside MobileProfile when
 * the user needs to audit "where did my free hours go".
 */
export function MobileBonuses() {
    const [bonuses, setBonuses] = useState<Bonus[]>([]);
    const [loading, setLoading] = useState(true);
    // Ошибка загрузки ≠ «бонусов нет»: раньше при сбое под тостом
    // оставалось «Нет бонусов в этом фильтре».
    const [loadFailed, setLoadFailed] = useState(false);
    const [filter, setFilter] = useState<Filter>('active');

    const load = async () => {
        setLoading(true);
        try {
            const list = await bonusesApi.getMyBonuses();
            setBonuses(list);
            setLoadFailed(false);
        } catch {
            setLoadFailed(true);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { load(); }, []);

    const filtered = useMemo(() => {
        return bonuses
            .filter(b => filter === 'all' ? true : filter === 'active' ? b.status === 'active' : b.status !== 'active')
            .sort((a, b) => {
                // Soonest-expiring first within active; newest-created first for the rest.
                if (filter === 'active') {
                    const ax = a.expiresAt ? parseISO(a.expiresAt).getTime() : Infinity;
                    const bx = b.expiresAt ? parseISO(b.expiresAt).getTime() : Infinity;
                    return ax - bx;
                }
                return parseISO(b.createdAt).getTime() - parseISO(a.createdAt).getTime();
            });
    }, [bonuses, filter]);

    const totals = useMemo(() => {
        const active = bonuses.filter(b => b.status === 'active');
        const totalActiveHours = active.reduce((s, b) => s + (b.quantity || 0), 0);
        const soon = active
            .filter(b => b.expiresAt)
            .sort((a, b) => parseISO(a.expiresAt!).getTime() - parseISO(b.expiresAt!).getTime())[0];
        return { totalActiveHours, activeCount: active.length, nearest: soon?.expiresAt ? formatDayMonth(soon.expiresAt) : null };
    }, [bonuses]);

    return (
        <div style={{ paddingBottom: 24 }}>
            {/* X2-19: «Назад» без истории (открыли из Telegram) — в «Я», а не из приложения. */}
            <MobilePageHeader title="Бонусы" fallbackTo="/m/me" />
            <div style={{ padding: '8px 16px 0', display: 'flex', flexDirection: 'column' }}>

            {/* 09.11 фаза 3: итог — общий SummaryCard (как абонемент): одно число,
                «ч» на той же линии, количество бонусов — подписью. */}
            <SummaryCard
                label="Активных бонусов"
                value={loading
                    ? <Skeleton width={56} height={28} />
                    : loadFailed ? '—' : <span className="num">{totals.totalActiveHours}</span>}
                unit={!loading && !loadFailed ? 'ч' : undefined}
                caption={!loading && !loadFailed
                    ? `${totals.activeCount} ${ruPlural(totals.activeCount, ['бонус', 'бонуса', 'бонусов'])}${totals.nearest ? ` · ближайший сгорает ${totals.nearest}` : ''}`
                    : undefined}
            />

            <div style={{ margin: '16px 0 12px' }}>
                <Segmented<Filter>
                    aria-label="Какие бонусы показать"
                    value={filter}
                    onChange={setFilter}
                    options={[
                        { value: 'active', label: 'Активные' },
                        { value: 'past', label: 'Прошлые' },
                        { value: 'all', label: 'Все' },
                    ]}
                />
            </div>

            {loading ? (
                <SkeletonList count={3} cardHeight={56} label="Загружаем бонусы" />
            ) : loadFailed ? (
                <ErrorBar message="Не удалось загрузить бонусы" onRetry={() => { void load(); }} />
            ) : filtered.length === 0 ? (
                <EmptyState compact illustration="cup" title={EMPTY_TITLE[filter]} />
            ) : (
                <ListGroup aria-label="Бонусы">
                    {filtered.map(b => {
                        const status = b.status;
                        const StatusIcon = status === 'active' ? Gift : status === 'used' ? Check : X;
                        const expiryStr = b.expiresAt ? formatDayMonth(b.expiresAt) : null;
                        // Бирка — только там, где статус не очевиден из фильтра.
                        const badge = status === 'active'
                            ? (filter === 'all' ? <span className="ui-badge ui-badge--ok">Активен</span> : null)
                            : <span className="ui-badge ui-badge--muted">{status === 'used' ? 'Использован' : 'Истёк'}</span>;
                        return (
                            <ListRow
                                key={b.id}
                                dimmed={status !== 'active'}
                                lead={<ListIcon><StatusIcon size={20} /></ListIcon>}
                                title={b.description || b.type || 'Бонус'}
                                subtitle={<>
                                    {formatDayMonth(b.createdAt, { withYear: 'auto' })}
                                    {expiryStr && status === 'active' && (
                                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, marginLeft: 6 }}>
                                            · <Clock size={14} aria-hidden="true" /> до {expiryStr}
                                        </span>
                                    )}
                                </>}
                                meta={badge ?? undefined}
                                trail={<span className="num">{b.quantity} ч</span>}
                            />
                        );
                    })}
                </ListGroup>
            )}

            {/* 09.11 фаза 3: справка — строками 14 px без серой плашки (тексты те же;
                пример про 2-часовую бронь — по ревью №18). */}
            <ListGroup bare title="Как тратятся бонусы" className="m-bonus-help">
                <ListRow
                    lead={<ListIcon><Info size={20} /></ListIcon>}
                    title={<span style={{ fontWeight: 500, fontSize: TEXT.small }}>Бонусные часы тратятся первыми — раньше абонемента и баланса. Сначала уходят те, что раньше сгорают.</span>}
                />
                <ListRow
                    lead={<ListIcon>{null}</ListIcon>}
                    title={<span style={{ fontWeight: 500, fontSize: TEXT.small }}><b>Нет абонемента?</b> Бонус идёт на любую бронь: например, 1 бонусный час на бронь в 2 часа — первый час бесплатно, второй оплачивается как обычно.</span>}
                />
                <ListRow
                    lead={<ListIcon>{null}</ListIcon>}
                    title={<span style={{ fontWeight: 500, fontSize: TEXT.small }}><b>Есть абонемент?</b> Бонус уйдёт только на бронь, которую оплатит полностью: 1 бонусный час — на бронь ровно в 1 час. На бронь в 2 часа пойдут часы абонемента, а бонус останется.</span>}
                />
                {/* X3-02: на сервере приветственный час живёт 15 дней
                    (auth.py WELCOME_BONUS_EXPIRY_DAYS), а тут было написано 90. */}
                <ListRow
                    lead={<ListIcon>{null}</ListIcon>}
                    title={<span style={{ fontWeight: 500, fontSize: TEXT.small }}>Приветственный бонус — 1 бесплатный час, действует 15 дней с регистрации (точная дата «до …» — в списке выше).</span>}
                />
            </ListGroup>
            </div>
        </div>
    );
}
