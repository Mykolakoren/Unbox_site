import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { MessageCircle, Phone, Plus } from 'lucide-react';
import type { CrmClient } from '../../../api/crm';
import { useCrmStore } from '../../../store/crmStore';
import { Button } from '../../../components/ui/Button';
import { Chip, Segmented } from '../../../components/ui/Chip';
import { EmptyState } from '../../../components/ui/EmptyState';
import { ErrorBar } from '../../../components/ui/ErrorBar';
import { SkeletonList } from '../../../components/ui/Skeleton';
import { NewClientSheet } from '../../../components/crm/NewClientSheet';
import { ListAvatar, ListGroup, ListRow } from '../../../components/ui/ListRow';
import { Money } from '../../../components/ui/Money';
import { MobilePageHeader } from '../../../components/ui/PageHeader';
import { CrmSearch } from './CrmSearch';
import { parseUTC, BATUMI_TZ } from '../../../utils/dateUtils';
import { formatDayMonth } from '../../../utils/format';
import { utcNaiveToTbilisi } from '../../../utils/crmNextSession';
import { useDocumentTitle } from '../../../hooks/useDocumentTitle';
import { phoneHref, telegramHref } from '../../../utils/contactLinks';
import { useCrmCalendar, useCrmDataVersion } from './crmDataVersion';
import { normalizeClientQuery, shortDay } from './crmFlows';
import { usePullToRefresh } from '../usePullToRefresh';
import { PullIndicator } from '../PullIndicator';

/** with_stats отдаёт ещё unpaidSum (долг по завершённым, в валюте клиента). */
type ClientRow = CrmClient & { unpaidSum?: number };

type ClientFilter = 'all' | 'debt' | 'noNext';

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
    // Ревью п. 12: «Все / С долгом / Без следующей».
    const [filter, setFilter] = useState<ClientFilter>('all');
    const calendar = useCrmCalendar();
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
        const q = normalizeClientQuery(query);
        const now = Date.now();
        let list = clients;
        if (activeOnly) list = list.filter(c => c.isActive);
        if (filter === 'debt') list = list.filter(c => (Number(c.unpaidSum ?? 0) || 0) > 0);
        if (filter === 'noNext') list = list.filter(c => !c.nextSessionDate || parseUTC(c.nextSessionDate).getTime() <= now);
        if (q) {
            const digits = q.replace(/\D/g, '');
            list = list.filter(c =>
                c.name?.toLowerCase().includes(q)
                || c.phone?.toLowerCase().includes(q)
                || (digits.length >= 3 && (c.phone || '').replace(/\D/g, '').includes(digits))
                || c.email?.toLowerCase().includes(q)
                || (c.aliasCode || '').replace(/^#+/, '').toLowerCase().includes(q)
            );
        }
        const byName = (a: ClientRow, b: ClientRow) => (a.name || '').localeCompare(b.name || '', 'ru');
        // «С долгом» — сначала самые большие долги.
        return [...list].sort(filter === 'debt'
            ? (a, b) => (Number(b.unpaidSum ?? 0) - Number(a.unpaidSum ?? 0)) || byName(a, b)
            : byName);
    }, [clients, query, activeOnly, filter]);

    const searching = !!query.trim();

    return (
        <div style={{ paddingBottom: 24, display: 'flex', flexDirection: 'column' }}>
            <PullIndicator distance={pull.distance} willRefresh={pull.willRefresh} refreshing={refreshing} />
            {/* 09.11 фаза 3: общая крупная шапка; счётчик — только при поиске («Найдено 3»). */}
            <MobilePageHeader
                variant="large"
                title="Клиенты"
                subtitle={loading && clients.length === 0 ? 'Загружаем…' : searching ? `Найдено: ${filtered.length}` : undefined}
                action={!viewingOther ? (
                    <Button icon={<Plus size={16} aria-hidden="true" />} onClick={() => setCreateOpen(true)}>
                        Клиент
                    </Button>
                ) : undefined}
            />

            <div style={{ padding: '0 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                <CrmSearch
                    value={query}
                    onChange={setQuery}
                    label="Поиск клиента: имя, код или телефон"
                    placeholder="Имя, код, телефон"
                />
                <Segmented<'active' | 'all'>
                    aria-label="Каких клиентов показать"
                    options={[
                        { value: 'active', label: 'Активные' },
                        { value: 'all', label: 'Все' },
                    ]}
                    value={activeOnly ? 'active' : 'all'}
                    onChange={v => setActiveOnly(v === 'active')}
                />
                <div role="group" aria-label="Отбор клиентов" className="ui-chip-row">
                    {([
                        { id: 'all', label: 'Все' },
                        { id: 'debt', label: 'С долгом' },
                        { id: 'noNext', label: 'Без следующей' },
                    ] as { id: ClientFilter; label: string }[]).map(f => (
                        <Chip key={f.id} selected={filter === f.id} aria-pressed={filter === f.id} onClick={() => setFilter(f.id)}>
                            {f.label}
                        </Chip>
                    ))}
                </div>
            </div>

            <div style={{ padding: '24px 16px 0', display: 'flex', flexDirection: 'column', gap: 12 }}>
            {failed && !loading && (
                <ErrorBar message="Не удалось загрузить клиентов" onRetry={load} />
            )}

            {loading && clients.length === 0 && (
                <SkeletonList count={5} label="Загружаем клиентов" cardHeight={60} />
            )}

            {!loading && !failed && filtered.length === 0 && (
                <div>
                    {query ? (
                        <EmptyState compact title="Никого не нашлось" hint="Попробуйте другое имя, телефон или код." />
                    ) : filter !== 'all' && clients.length > 0 ? (
                        <EmptyState
                            compact
                            title={filter === 'debt' ? 'Долгов нет' : 'У всех есть следующая встреча'}
                            hint="Выберите «Все», чтобы увидеть весь список."
                        />
                    ) : calendar.connected === false ? (
                        // Ревью п. 6: без календаря «появится после синхронизации» — неправда.
                        <EmptyState
                            compact
                            title="Клиентов пока нет"
                            hint="Добавьте клиента здесь. Чтобы клиенты и встречи появлялись сами из Google Календаря, подключите его."
                            action={viewingOther ? undefined : { label: 'Добавить клиента', variant: 'secondary', onClick: () => setCreateOpen(true) }}
                            secondaryAction={!viewingOther && calendar.openSetup ? { label: 'Подключить календарь', onClick: calendar.openSetup } : undefined}
                        />
                    ) : (
                        <EmptyState
                            compact
                            title="Клиентов пока нет"
                            hint="Добавьте клиента здесь — или запишите встречу в Google Календарь, клиент появится после синхронизации (кнопка ⟳ на «Сегодня»)."
                            action={viewingOther ? undefined : { label: 'Добавить клиента', variant: 'secondary', onClick: () => setCreateOpen(true) }}
                        />
                    )}
                </div>
            )}

            {filtered.length > 0 && (
                // Дизайн-ревью п. 3, 10, 12: одна группа строк; код клиента не в строке
                // (он в карточке); долг — справа суммой, не режется; звонок/Telegram — в карточке.
                <ListGroup aria-label="Клиенты">
                    {filtered.map(c => {
                        const debt = Number(c.unpaidSum ?? 0) || 0;
                        // Одна кнопка связи фиксированной ширины (правый край ровный):
                        // Telegram, если есть, иначе звонок. Обе — в карточке клиента.
                        const tg = telegramHref(c.telegram);
                        const tel = phoneHref(c.phone);
                        const contact = tg ? (
                            <a href={tg} target="_blank" rel="noopener noreferrer" aria-label={`Написать в Telegram: ${c.name}`}
                                className="ui-btn ui-btn--quiet ui-btn--sm ui-btn--icon" style={{ color: 'var(--color-ink-60)' }}>
                                <MessageCircle size={18} aria-hidden="true" />
                            </a>
                        ) : tel ? (
                            <a href={tel} aria-label={`Позвонить: ${c.name}`}
                                className="ui-btn ui-btn--quiet ui-btn--sm ui-btn--icon" style={{ color: 'var(--color-ink-60)' }}>
                                <Phone size={18} aria-hidden="true" />
                            </a>
                        ) : undefined;
                        return (
                            <ListRow
                                key={c.id}
                                to={`/m/crm/clients/${c.id}`}
                                lead={<ListAvatar name={c.name || '?'} />}
                                title={c.name}
                                subtitle={clientSecondLine(c)}
                                trail={debt > 0 ? <Money value={debt} currency={c.currency || 'GEL'} tone="debt" /> : undefined}
                                trailSub={debt > 0 ? 'долг' : undefined}
                                dimmed={!c.isActive}
                                action={contact}
                            />
                        );
                    })}
                </ListGroup>
            )}
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

/** Вторая строка (G6-22): «след. чт, 2 окт., 16:00». Нет следующей — «была 23 сент.»;
 *  нет истории — телефон/почта. Долг — справа суммой (дизайн-ревью п. 12). */
function clientSecondLine(c: ClientRow): string {
    const next = c.nextSessionDate ? utcNaiveToTbilisi(c.nextSessionDate) : null;
    if (next) return `след. ${shortDay(next.date)}, ${next.time}`;
    if (c.lastPastSessionDate) return `была ${formatDayMonth(parseUTC(c.lastPastSessionDate), { timeZone: BATUMI_TZ, withYear: 'auto' })}`;
    return c.phone || c.email || (c.tags?.length ? c.tags.slice(0, 2).join(', ') : 'сессий ещё не было');
}
