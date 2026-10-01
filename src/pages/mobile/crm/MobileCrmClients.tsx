import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Phone, Search, MessageCircle, X, Plus } from 'lucide-react';
import type { CrmClient } from '../../../api/crm';
import { useCrmStore } from '../../../store/crmStore';
import { Button } from '../../../components/ui/Button';
import { Segmented } from '../../../components/ui/Chip';
import { EmptyState } from '../../../components/ui/EmptyState';
import { ErrorBar } from '../../../components/ui/ErrorBar';
import { SkeletonList } from '../../../components/ui/Skeleton';
import { NewClientSheet } from '../../../components/crm/NewClientSheet';
import { COLOR } from '../../../design/tokens';
import { parseUTC, BATUMI_TZ } from '../../../utils/dateUtils';
import { formatDayMonth, formatMoney } from '../../../utils/format';
import { utcNaiveToTbilisi } from '../../../utils/crmNextSession';
import { useDocumentTitle } from '../../../hooks/useDocumentTitle';
import { useCrmDataVersion } from './crmDataVersion';
import { shortDay } from './crmFlows';
import { usePullToRefresh } from '../usePullToRefresh';
import { PullIndicator } from '../PullIndicator';

/** with_stats отдаёт ещё unpaidSum (долг по завершённым, в валюте клиента). */
type ClientRow = CrmClient & { unpaidSum?: number };

/** Прокручивается документ, а не <main> оболочки — его и проверяем. */
const docScroller = () => (document.scrollingElement as HTMLElement | null);

/**
 * Mobile CRM — clients list with search.
 *
 * Plain alphabetical list with a sticky search box on top. Tap → client
 * card (separate route). Active filter: hide archived/inactive.
 *
 * Wave 1: «Только активные» — переключатель «Активные / Все» вместо
 * синего системного чекбокса; звонок и Telegram — соседние кнопки 44 px,
 * а не ссылки внутри ссылки (ошибка «<a> cannot contain <a>»);
 * загрузка/ошибка/пусто — три разных состояния.
 *
 * Волна 3: «+ Клиент» в шапке и в пустом списке (X2-01/X5-18) —
 * NewClientSheet со свободным кодом #XXXX, после создания открывается
 * карточка. Вторая строка — «след.: чт, 2 окт., 16:00 · долг 140 ₾»
 * (G6-22, список со статистикой), инициалы из двух букв, потянуть вниз —
 * обновить.
 */
export function MobileCrmClients() {
    const navigate = useNavigate();
    const clients = useCrmStore(s => s.clients) as ClientRow[];
    const fetchClients = useCrmStore(s => s.fetchClients);
    const viewingOther = useCrmStore(s => !!s.viewAsSpecialistId);
    const [query, setQuery] = useState('');
    const [activeOnly, setActiveOnly] = useState(true);
    const [loading, setLoading] = useState(false);
    const [failed, setFailed] = useState(false);
    const [createOpen, setCreateOpen] = useState(false);
    const dataVersion = useCrmDataVersion();
    useDocumentTitle('Клиенты · Psy-CRM');

    // Стор ошибку не бросает, а кладёт в error — смотрим туда.
    const load = useCallback(async () => {
        setLoading(true);
        setFailed(false);
        await fetchClients(false, true);
        setFailed(!!useCrmStore.getState().error);
        setLoading(false);
    }, [fetchClients]);

    // Каждый заход — свежий список со статистикой (след. встреча, долг).
    useEffect(() => { load(); }, [load, dataVersion]);

    const [refreshing, setRefreshing] = useState(false);
    const pull = usePullToRefresh(async () => {
        setRefreshing(true);
        try { await load(); } finally { setRefreshing(false); }
    }, 70, docScroller);

    const filtered = useMemo(() => {
        const q = query.trim().toLowerCase();
        let list = clients;
        if (activeOnly) list = list.filter(c => c.isActive);
        if (q) {
            list = list.filter(c =>
                c.name?.toLowerCase().includes(q)
                || c.phone?.toLowerCase().includes(q)
                || c.email?.toLowerCase().includes(q)
                || c.aliasCode?.toLowerCase().includes(q)
            );
        }
        return [...list].sort((a, b) => (a.name || '').localeCompare(b.name || '', 'ru'));
    }, [clients, query, activeOnly]);

    return (
        <div style={{ paddingTop: 12, paddingBottom: 24, display: 'flex', flexDirection: 'column', gap: 12 }}>
            <PullIndicator distance={pull.distance} willRefresh={pull.willRefresh} refreshing={refreshing} />
            <div style={{ padding: '0 16px', display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                    <h1 style={{ fontSize: 24, fontWeight: 600, letterSpacing: '-0.02em', margin: 0 }}>
                        Клиенты
                    </h1>
                    <p style={{ fontSize: 14, color: 'var(--color-ink-60)', marginTop: 4 }}>
                        {loading && clients.length === 0 ? 'Загружаем…' : `Всего: ${clients.length} · показано: ${filtered.length}`}
                    </p>
                </div>
                {!viewingOther && (
                    <Button size="touch" icon={<Plus size={16} aria-hidden="true" />} onClick={() => setCreateOpen(true)}>
                        Клиент
                    </Button>
                )}
            </div>

            {/* Search */}
            <div style={{ padding: '0 16px' }}>
                <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    background: 'var(--color-sunken)',
                    borderRadius: 12,
                    padding: '0 0 0 12px',
                    minHeight: 44,
                    gap: 8,
                }}>
                    <Search size={16} color={COLOR.ink60} aria-hidden="true" />
                    <input
                        value={query}
                        onChange={e => setQuery(e.target.value)}
                        aria-label="Поиск клиента"
                        placeholder="Имя, телефон, email…"
                        style={{
                            flex: 1,
                            background: 'transparent',
                            border: 'none',
                            outline: 'none',
                            fontSize: 16,
                            fontFamily: 'inherit',
                            color: 'var(--color-ink)',
                            minWidth: 0,
                        }}
                    />
                    {query && (
                        <button
                            onClick={() => setQuery('')}
                            aria-label="Очистить поиск"
                            style={{
                                background: 'none', border: 'none', cursor: 'pointer',
                                color: 'var(--color-ink-60)', width: 44, height: 44,
                                display: 'grid', placeItems: 'center', flexShrink: 0,
                            }}
                        >
                            <X size={16} aria-hidden="true" />
                        </button>
                    )}
                </div>
                <Segmented<'active' | 'all'>
                    aria-label="Каких клиентов показать"
                    className="mt-2"
                    options={[
                        { value: 'active', label: 'Активные' },
                        { value: 'all', label: 'Все' },
                    ]}
                    value={activeOnly ? 'active' : 'all'}
                    onChange={v => setActiveOnly(v === 'active')}
                />
            </div>

            {failed && !loading && (
                <div style={{ padding: '0 16px' }}>
                    <ErrorBar message="Не удалось загрузить клиентов" onRetry={load} />
                </div>
            )}

            {loading && clients.length === 0 && (
                <div style={{ padding: '0 16px' }}>
                    <SkeletonList count={5} label="Загружаем клиентов" cardHeight={60} />
                </div>
            )}

            {!loading && !failed && filtered.length === 0 && (
                <div style={{ padding: '0 16px' }}>
                    {query ? (
                        <EmptyState compact title="Никого не нашлось" hint="Попробуйте другое имя, телефон или код." />
                    ) : (
                        <EmptyState
                            compact
                            title="Клиентов пока нет"
                            hint="Добавьте клиента здесь — или запишите встречу в Google Календарь, клиент появится после синхронизации."
                            action={viewingOther ? undefined : { label: 'Добавить клиента', onClick: () => setCreateOpen(true) }}
                        />
                    )}
                </div>
            )}

            <div style={{ padding: '0 16px', display: 'flex', flexDirection: 'column', gap: 6 }}>
                {filtered.map(c => (
                    <div
                        key={c.id}
                        style={{
                            background: 'var(--color-card)',
                            border: '1px solid var(--color-ink-08)',
                            borderRadius: 12,
                            display: 'flex',
                            alignItems: 'center',
                            gap: 4,
                            paddingRight: 6,
                        }}
                    >
                        <Link
                            to={`/m/crm/clients/${c.id}`}
                            style={{
                                flex: 1,
                                minWidth: 0,
                                padding: '12px 8px 12px 14px',
                                display: 'flex',
                                alignItems: 'center',
                                gap: 10,
                                color: 'var(--color-ink)',
                                textDecoration: 'none',
                            }}
                        >
                            <div style={{
                                width: 36, height: 36,
                                borderRadius: 999,
                                background: 'var(--color-sunken)',
                                display: 'grid', placeItems: 'center',
                                fontSize: 14, fontWeight: 600,
                                color: 'var(--color-ink-60)',
                                flexShrink: 0,
                            }}>
                                {initials(c.name)}
                            </div>
                            <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ fontSize: 14, fontWeight: 600, lineHeight: 1.25, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                    {c.aliasCode ? `${c.aliasCode} · ${c.name}` : c.name}
                                </div>
                                <ClientSecondLine c={c} />
                            </div>
                        </Link>
                        {c.phone && (
                            <a
                                href={`tel:${c.phone.replace(/\s/g, '')}`}
                                aria-label={`Позвонить: ${c.name}`}
                                style={iconBtn}
                            >
                                <Phone size={16} aria-hidden="true" />
                            </a>
                        )}
                        {c.telegram && (
                            <a
                                href={`https://t.me/${c.telegram.replace('@', '')}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                aria-label={`Написать в Telegram: ${c.name}`}
                                style={iconBtn}
                            >
                                <MessageCircle size={16} aria-hidden="true" />
                            </a>
                        )}
                    </div>
                ))}
            </div>

            <NewClientSheet
                open={createOpen}
                onClose={() => setCreateOpen(false)}
                clients={clients}
                initialName={query.trim() && filtered.length === 0 ? query.trim() : ''}
                onCreated={(c) => {
                    // Шторка стор не обновляет — перечитываем и открываем карточку.
                    load();
                    navigate(`/m/crm/clients/${c.id}`);
                }}
            />
        </div>
    );
}

/** Инициалы из двух букв, как в «Финансах»: «Анна Ким» → «АК». */
function initials(name: string | undefined): string {
    return (name || '').split(/\s+/).filter(Boolean).slice(0, 2).map(s => s[0]?.toUpperCase()).join('') || '?';
}

/** Вторая строка (G6-22): «след.: чт, 2 окт., 16:00 · долг 140 ₾».
 *  Нет следующей — «была 23 сент.»; нет истории — телефон/почта. */
function ClientSecondLine({ c }: { c: ClientRow }) {
    const next = c.nextSessionDate ? utcNaiveToTbilisi(c.nextSessionDate) : null;
    const debt = Number(c.unpaidSum ?? 0) || 0;
    const parts: string[] = [];
    if (next) parts.push(`след.: ${shortDay(next.date)}, ${next.time}`);
    else if (c.lastPastSessionDate) parts.push(`была ${formatDayMonth(parseUTC(c.lastPastSessionDate), { timeZone: BATUMI_TZ, withYear: 'auto' })}`);
    else parts.push(c.phone || c.email || (c.tags?.length ? c.tags.slice(0, 2).join(', ') : 'сессий ещё не было'));
    return (
        <div style={{ fontSize: 12, color: 'var(--color-ink-60)', marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {parts.join(' · ')}
            {debt > 0 && (
                <span style={{ color: 'var(--status-danger-fg)', fontWeight: 600 }}>
                    {' · '}долг {formatMoney(debt, { currency: c.currency || 'GEL' })}
                </span>
            )}
        </div>
    );
}

const iconBtn: React.CSSProperties = {
    width: 44, height: 44,
    borderRadius: 8,
    background: 'var(--color-sunken)',
    display: 'grid', placeItems: 'center',
    color: 'var(--color-ink)',
    flexShrink: 0,
    textDecoration: 'none',
};
