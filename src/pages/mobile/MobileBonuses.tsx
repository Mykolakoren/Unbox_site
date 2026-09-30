import { useEffect, useMemo, useState } from 'react';
import { Gift, Clock, Check, Info, X } from 'lucide-react';
import { parseISO } from 'date-fns';
import { bonusesApi, type Bonus } from '../../api/bonuses';
import { COLOR, STATUS } from '../../design/tokens';
import { formatDayMonth } from '../../utils/format';
import { ruPlural } from '../../utils/plural';
import { SkeletonList } from '../../components/ui/Skeleton';
import { ErrorBar } from '../../components/ui/ErrorBar';
import { EmptyState } from '../../components/ui/EmptyState';
import { Chip } from '../../components/ui/Chip';
import { MobilePageHeader } from '../../components/ui/PageHeader';

type Filter = 'active' | 'used' | 'expired' | 'all';

const FILTER_LABEL: Record<Filter, string> = {
    active: 'Активные',
    used: 'Использованные',
    expired: 'Истёкшие',
    all: 'Все',
};

/** Пусто — своя фраза для каждого фильтра. */
const EMPTY_TITLE: Record<Filter, string> = {
    active: 'Активных бонусов нет',
    used: 'Использованных бонусов нет',
    expired: 'Истёкших бонусов нет',
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
            .filter(b => filter === 'all' ? true : b.status === filter)
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
        return { totalActiveHours, activeCount: active.length };
    }, [bonuses]);

    return (
        <div style={{ paddingBottom: 24 }}>
            {/* X2-19: «Назад» без истории (открыли из Telegram) — в «Я», а не из приложения. */}
            <MobilePageHeader title="Бонусы" fallbackTo="/m/me" />
            <div style={{ padding: '8px 16px 0' }}>

            {/* Hero strip — total active hours. Wave 1: ровная поверхность
                вместо жёлтого градиента — цвет только для статуса. */}
            <div style={{
                background: COLOR.sunken,
                color: COLOR.ink,
                borderRadius: 14,
                padding: '16px 18px',
                marginBottom: 14,
                display: 'flex', alignItems: 'center', gap: 14,
            }}>
                <Gift size={28} />
                <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: COLOR.ink60 }}>
                        Активных бонусов
                    </div>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginTop: 2 }}>
                        {loading ? (
                            <span style={{ fontSize: 14, color: COLOR.ink60 }}>Загружаем…</span>
                        ) : loadFailed ? (
                            <span style={{ fontSize: 14, color: COLOR.ink60 }}>—</span>
                        ) : (
                            <>
                                <span className="num" style={{ fontSize: 28, fontWeight: 600 }}>
                                    {totals.totalActiveHours}
                                </span>
                                <span style={{ fontSize: 13 }}>ч</span>
                                <span style={{ fontSize: 12, color: COLOR.ink60, marginLeft: 6 }}>
                                    · {totals.activeCount} {ruPlural(totals.activeCount, ['бонус', 'бонуса', 'бонусов'])}
                                </span>
                            </>
                        )}
                    </div>
                </div>
            </div>

            {/* Filter chips */}
            {/* Wave 1: общие Chip (44 px, aria-pressed) с переносом. */}
            <div className="ui-chip-row" role="group" aria-label="Какие бонусы показать" style={{ marginBottom: 12 }}>
                {(['active', 'used', 'expired', 'all'] as Filter[]).map(f => (
                    <Chip key={f} selected={filter === f} onClick={() => setFilter(f)}>
                        {FILTER_LABEL[f]}
                    </Chip>
                ))}
            </div>

            {loading ? (
                <SkeletonList count={3} cardHeight={56} label="Загружаем бонусы" />
            ) : loadFailed ? (
                <ErrorBar message="Не удалось загрузить бонусы" onRetry={() => { void load(); }} />
            ) : filtered.length === 0 ? (
                <EmptyState compact title={EMPTY_TITLE[filter]} />
            ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                    {filtered.map(b => {
                        const status = b.status;
                        // Цвета — только статусные токены: активен = ок,
                        // использован = прошло, истёк = сгорел.
                        const palette = status === 'active'
                            ? { bg: STATUS.ok.bg, fg: STATUS.ok.fg, label: 'Активен' }
                            : status === 'used'
                                ? { bg: STATUS.muted.bg, fg: STATUS.muted.fg, label: 'Использован' }
                                : { bg: STATUS.danger.bg, fg: STATUS.danger.fg, label: 'Истёк' };
                        const StatusIcon = status === 'active' ? Gift : status === 'used' ? Check : X;
                        const expiryStr = b.expiresAt ? formatDayMonth(b.expiresAt) : null;
                        return (
                            <div key={b.id} style={{
                                background: COLOR.card,
                                border: `1px solid ${COLOR.ink05}`,
                                borderRadius: 11,
                                padding: '11px 12px',
                                display: 'flex',
                                alignItems: 'center',
                                gap: 10,
                            }}>
                                <div style={{
                                    width: 32, height: 32, borderRadius: 8,
                                    background: palette.bg, color: palette.fg,
                                    display: 'grid', placeItems: 'center', flexShrink: 0,
                                }}>
                                    <StatusIcon size={14} aria-hidden="true" />
                                </div>
                                <div style={{ flex: 1, minWidth: 0 }}>
                                    <div style={{ fontSize: 13, fontWeight: 600, color: COLOR.ink, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                        {b.description || b.type || 'Бонус'} · {b.quantity} ч
                                    </div>
                                    <div style={{ fontSize: 12, color: COLOR.ink60, marginTop: 1, display: 'flex', alignItems: 'center', gap: 5 }}>
                                        <span style={{ color: palette.fg, fontWeight: 600 }}>{palette.label}</span>
                                        <span>·</span>
                                        <span>{formatDayMonth(b.createdAt, { withYear: 'auto' })}</span>
                                        {expiryStr && status === 'active' && (
                                            <>
                                                <span>·</span>
                                                <Clock size={12} aria-hidden="true" />
                                                <span>до {expiryStr}</span>
                                            </>
                                        )}
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}

            <div style={{
                marginTop: 16,
                padding: 12,
                background: COLOR.sunken,
                borderRadius: 10,
                fontSize: 12,
                color: COLOR.ink80,
                lineHeight: 1.5,
                display: 'flex',
                gap: 8,
                alignItems: 'flex-start',
            }}>
                <Info size={16} aria-hidden="true" style={{ flexShrink: 0, marginTop: 1, color: COLOR.ink60 }} />
                {/* X3-02: на сервере приветственный час живёт 15 дней
                    (auth.py WELCOME_BONUS_EXPIRY_DAYS), а тут было написано 90 —
                    клиент откладывал час, и тот сгорал. */}
                <span>
                    Если бонусных часов хватает на всю бронь, они тратятся первыми — раньше абонемента и баланса.
                    Сначала уходят те, что раньше сгорают. Приветственный бонус — 1 бесплатный час, действует 15 дней с регистрации
                    (точная дата «до …» — в списке выше).
                </span>
            </div>
            </div>
        </div>
    );
}
