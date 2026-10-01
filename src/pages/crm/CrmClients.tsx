import { useEffect, useState, useMemo, type CSSProperties, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useCrmStore } from '../../store/crmStore';
import { useUserStore } from '../../store/userStore';
import { Plus, Search, Phone, Mail, X, Send, Merge, Trash2 } from 'lucide-react';
import type { CrmClient } from '../../api/crm';
import { crmApi } from '../../api/crm';
import { toast } from 'sonner';
import { GH, GH_SANS, GH_MONO } from '../../hooks/useDesignFlag';
import { useDocumentTitle } from '../../hooks/useDocumentTitle';
import { STATUS } from '../../design/tokens';
import { formatMoney, formatDayMonthShort, formatTime, formatWeekdayShort } from '../../utils/format';
import { ruCountWord } from '../../utils/plural';
import { parseUTC, BATUMI_TZ } from '../../utils/dateUtils';
import { toastApiError } from '../../utils/errors';
import { useConfirmDialog } from '../../components/ui/ConfirmDialogProvider';
import { StatusBadge } from '../../components/ui/StatusBadge';
import { Skeleton } from '../../components/ui/Skeleton';
import { ErrorBar } from '../../components/ui/ErrorBar';
import { EmptyState } from '../../components/ui/EmptyState';
import { PageHeader } from '../../components/ui/PageHeader';
import { Button } from '../../components/ui/Button';
import { Sheet } from '../../components/ui/Sheet';
import { NewClientSheet } from '../../components/crm/NewClientSheet';

/**
 * Список клиентов Psy-CRM на компьютере (волна 3, пакет C).
 *
 * - Колонки «Следующая» и «Была» (with_stats: nextSessionDate,
 *   lastPastSessionDate) вместо «Посл. сессия», которая показывала будущую
 *   дату (G5-17). По умолчанию сортируем по «Следующей»: ближайшие сверху,
 *   без записи — внизу.
 * - Строка — ссылка (Link): Tab доходит до клиента, Enter открывает карточку,
 *   можно открыть в новой вкладке (G5-14 / X4-10).
 * - «+ Клиент» — общая шторка NewClientSheet (код сразу свободный, В2),
 *   после создания — карточка клиента.
 * - Окно слияния — на общем Sheet (X4-04). API слияния прежнее.
 * - Точка-выключатель и номера строк убраны (G5-10): пауза — в карточке.
 */

type SortField = 'name' | 'basePrice' | 'sessionCount' | 'unpaidSum' | 'totalPaid' | 'nextSessionDate' | 'lastPastSessionDate';
type SortDir = 'asc' | 'desc';

const TZ = { timeZone: BATUMI_TZ };
const SESSIONS: [string, string, string] = ['сессия', 'сессии', 'сессий'];

/** «чт, 2 окт., 16:00» по Батуми. */
function nextLabel(utcNaive: string): string {
    const d = parseUTC(utcNaive);
    return `${formatWeekdayShort(d, { capitalize: false, ...TZ })}, ${formatDayMonthShort(d, { withYear: 'auto', ...TZ })}, ${formatTime(d, TZ)}`;
}

export function CrmClients() {
    const { clients, fetchClients, deleteClient, loading, error } = useCrmStore();
    const viewingOther = useCrmStore(s => !!s.viewAsSpecialistId);
    const { confirm } = useConfirmDialog();
    const navigate = useNavigate();
    // Пока первый ответ не пришёл — скелетон, а не «Клиентов ещё нет» (rule 8).
    const [fetchedOnce, setFetchedOnce] = useState(false);
    const { currentUser } = useUserStore();
    const [search, setSearch] = useState('');
    const [showInactive, setShowInactive] = useState(false);
    const [newClientOpen, setNewClientOpen] = useState(false);
    const [sortField, setSortField] = useState<SortField>('nextSessionDate');
    const [sortDir, setSortDir] = useState<SortDir>('asc');
    const [mergeMode, setMergeMode] = useState(false);
    const [mergeSelected, setMergeSelected] = useState<string[]>([]);
    const [showMergeDialog, setShowMergeDialog] = useState(false);

    useDocumentTitle('Клиенты · Psy-CRM');

    // Удалить карточку навсегда сервер разрешает только владельцу и старшему
    // администратору — остальным корзину не показываем (раньше она всегда
    // отвечала ошибкой 403).
    const canDeleteForever = currentUser?.role === 'owner' || currentUser?.role === 'senior_admin';

    useEffect(() => {
        fetchClients(false, true).finally(() => setFetchedOnce(true));
    }, [fetchClients]);

    const toggleSort = (field: SortField) => {
        if (sortField === field) {
            setSortDir(d => d === 'asc' ? 'desc' : 'asc');
        } else {
            setSortField(field);
            // Даты «Следующей» — от ближайшей; остальное — от большего.
            setSortDir(field === 'name' || field === 'nextSessionDate' ? 'asc' : 'desc');
        }
    };

    const filtered = useMemo(() => {
        let result = clients.filter((c) => {
            if (!showInactive && !c.isActive) return false;
            if (!search) return true;
            const q = search.toLowerCase();
            return (
                c.name.toLowerCase().includes(q) ||
                c.phone?.toLowerCase().includes(q) ||
                c.email?.toLowerCase().includes(q) ||
                c.telegram?.toLowerCase().includes(q) ||
                c.aliasCode?.includes(q.replace(/^#/, ''))
            );
        });

        result = [...result].sort((a, b) => {
            const dir = sortDir === 'asc' ? 1 : -1;
            switch (sortField) {
                case 'name':
                    return dir * a.name.localeCompare(b.name);
                case 'basePrice':
                    return dir * ((a.basePrice || 0) - (b.basePrice || 0));
                case 'sessionCount':
                    return dir * (((a as any).sessionCount || 0) - ((b as any).sessionCount || 0));
                case 'unpaidSum':
                    return dir * (((a as any).unpaidSum || 0) - ((b as any).unpaidSum || 0));
                case 'totalPaid':
                    return dir * (((a as any).totalPaid || 0) - ((b as any).totalPaid || 0));
                case 'nextSessionDate':
                case 'lastPastSessionDate': {
                    const da = a[sortField] || '';
                    const db = b[sortField] || '';
                    if (!da && !db) return a.name.localeCompare(b.name);
                    if (!da) return 1; // без даты — всегда внизу
                    if (!db) return -1;
                    return dir * da.localeCompare(db);
                }
                default:
                    return 0;
            }
        });

        return result;
    }, [clients, search, showInactive, sortField, sortDir]);

    const onPermanentDelete = async (client: CrmClient) => {
        const ok = await confirm({
            title: `Удалить клиента «${client.name}»?`,
            body: 'Все сессии, платежи и заметки клиента удалятся навсегда. Вернуть их будет нельзя.',
            confirmLabel: 'Удалить клиента',
            cancelLabel: 'Оставить',
            tone: 'danger',
        });
        if (!ok) return;
        try {
            await deleteClient(client.id, true);
            toast.success(`${client.name} удалён`);
            fetchClients(false, true);
        } catch (err: any) {
            toast.error(err?.response?.data?.detail || 'Ошибка удаления');
        }
    };

    const onMergeConfirm = async (targetId: string, overrides: MergeOverrides) => {
        const sourceIds = mergeSelected.filter(id => id !== targetId);
        try {
            const result = await crmApi.mergeClients({ targetId, sourceIds, ...overrides });
            toast.success(
                `Объединили карточки: ${result.mergedCount}. Перенесли ${ruCountWord(result.reassigned.sessions, SESSIONS)}, `
                + `${ruCountWord(result.reassigned.payments, ['платёж', 'платежа', 'платежей'])}, `
                + `${ruCountWord(result.reassigned.notes, ['заметку', 'заметки', 'заметок'])}`,
            );
            setShowMergeDialog(false);
            setMergeMode(false);
            setMergeSelected([]);
            fetchClients(false, true);
        } catch (err: any) {
            toastApiError(err, 'Не удалось объединить карточки. Попробуйте ещё раз');
        }
    };

    const isLoading = loading || !fetchedOnce;
    const loadError = fetchedOnce && !loading ? error : null;
    const activeCount = clients.filter(c => c.isActive).length;
    const inactiveCount = clients.length - activeCount;
    const canMerge = !viewingOther && clients.length >= 2;

    return (
        <div style={{ fontFamily: GH_SANS, color: GH.ink, background: GH.paper }}>
            <PageHeader
                title="Клиенты"
                description={clients.length ? `Активных ${activeCount} из ${clients.length}` : undefined}
                actions={!viewingOther && (
                    <>
                        {canMerge && (
                            <Button
                                variant={mergeMode ? 'secondary' : 'quiet'}
                                icon={<Merge size={16} aria-hidden="true" />}
                                aria-pressed={mergeMode}
                                onClick={() => { setMergeMode(!mergeMode); setMergeSelected([]); }}
                            >
                                {mergeMode ? 'Отменить слияние' : 'Слить дубли'}
                            </Button>
                        )}
                        <Button icon={<Plus size={16} aria-hidden="true" />} onClick={() => setNewClientOpen(true)}>Клиент</Button>
                    </>
                )}
            />

            {/* ── Поиск и фильтр ── */}
            <div style={{ display: 'flex', gap: 24, alignItems: 'center', marginBottom: 20, flexWrap: 'wrap' }}>
                <div style={{ flex: '1 1 320px', display: 'flex', alignItems: 'center', gap: 12, borderBottom: `1px solid ${GH.ink30}`, minHeight: 40 }}>
                    <Search size={16} color={GH.ink60} aria-hidden="true" />
                    <input
                        type="search"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder="Имя, телефон, Telegram или код"
                        aria-label="Поиск клиента"
                        style={{ flex: 1, border: 'none', background: 'transparent', fontFamily: GH_SANS, fontSize: 15, color: GH.ink, minHeight: 36 }}
                    />
                    {search && (
                        <button
                            onClick={() => setSearch('')}
                            style={{ background: 'none', border: 'none', cursor: 'pointer', color: GH.ink60, display: 'flex', width: 32, height: 32, alignItems: 'center', justifyContent: 'center' }}
                            aria-label="Очистить поиск"
                        >
                            <X size={16} />
                        </button>
                    )}
                </div>
                {inactiveCount > 0 && (
                    <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', userSelect: 'none', fontSize: 14, color: GH.ink, minHeight: 32 }}>
                        <input
                            type="checkbox"
                            checked={showInactive}
                            onChange={(e) => setShowInactive(e.target.checked)}
                            style={{ accentColor: GH.ink, cursor: 'pointer', margin: 0, width: 16, height: 16 }}
                        />
                        Показать на паузе ({inactiveCount})
                    </label>
                )}
            </div>

            {/* ── Режим слияния ── */}
            {mergeMode && (
                <div
                    role="status"
                    style={{
                        border: `1px solid ${GH.ink}`, padding: '12px 16px', marginBottom: 16,
                        display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12,
                        background: GH.card,
                    }}
                >
                    <div style={{ fontSize: 14 }}>
                        Отметьте 2 и больше карточек одного человека — сессии, платежи и заметки соберём в одну.
                    </div>
                    <Button
                        variant="danger"
                        disabled={mergeSelected.length < 2}
                        onClick={() => setShowMergeDialog(true)}
                    >
                        {mergeSelected.length < 2 ? 'Выберите карточки' : `Объединить (${mergeSelected.length})`}
                    </Button>
                </div>
            )}

            {/* ── Таблица — загрузка ≠ ошибка ≠ пусто (rule 8). ── */}
            {loadError && (
                <ErrorBar message="Не удалось загрузить клиентов" onRetry={() => fetchClients(false, true)} retrying={loading} className="mb-4" />
            )}
            {isLoading && !clients.length ? (
                <div role="status" aria-busy="true" style={{ border: `1px solid ${GH.ink10}` }}>
                    <span className="sr-only">Загружаем клиентов…</span>
                    {Array.from({ length: 6 }, (_, i) => (
                        <div key={i} style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr 1fr 0.6fr', gap: 24, padding: '16px 20px', borderBottom: i < 5 ? `1px solid ${GH.ink10}` : 'none' }}>
                            <Skeleton height={18} radius={0} />
                            <Skeleton height={18} radius={0} />
                            <Skeleton height={18} radius={0} />
                            <Skeleton height={18} radius={0} />
                        </div>
                    ))}
                </div>
            ) : filtered.length === 0 ? (
                loadError && !clients.length ? null : (
                    <div style={{ border: `1px solid ${GH.ink10}` }}>
                        {search ? (
                            <EmptyState
                                title="Никого не нашли"
                                hint="Попробуйте другое имя или код клиента."
                                action={{ label: 'Очистить поиск', onClick: () => setSearch('') }}
                            />
                        ) : clients.length > 0 ? (
                            <EmptyState
                                title="Все клиенты на паузе"
                                hint="Покажите их, чтобы открыть карточку и вернуть в работу."
                                action={{ label: 'Показать на паузе', onClick: () => setShowInactive(true) }}
                            />
                        ) : (
                            <>
                                <EmptyState
                                    title="Клиентов пока нет"
                                    hint={viewingOther ? undefined : 'Добавьте первого клиента — займёт минуту. Или подключите Google Календарь: клиенты подтянутся сами по коду #XXXX.'}
                                    action={viewingOther ? undefined : { label: 'Добавить первого клиента', onClick: () => setNewClientOpen(true) }}
                                />
                                {!viewingOther && (
                                    <div style={{ display: 'flex', justifyContent: 'center', paddingBottom: 24, marginTop: -8 }}>
                                        <Button variant="quiet" onClick={() => navigate('/crm/settings')}>Подключить Google Календарь</Button>
                                    </div>
                                )}
                            </>
                        )}
                    </div>
                )
            ) : (
                <ClientsTable
                    rows={filtered}
                    mergeMode={mergeMode}
                    mergeSelected={mergeSelected}
                    setMergeSelected={setMergeSelected}
                    sortField={sortField}
                    sortDir={sortDir}
                    toggleSort={toggleSort}
                    canDeleteForever={canDeleteForever && !viewingOther}
                    onPermanentDelete={onPermanentDelete}
                />
            )}

            <NewClientSheet
                open={newClientOpen}
                onClose={() => setNewClientOpen(false)}
                clients={clients}
                initialName={search && !filtered.length ? search : undefined}
                onCreated={(client) => {
                    setNewClientOpen(false);
                    fetchClients(false, true);
                    // Сразу в карточку: оттуда «Записать на …» первую сессию.
                    navigate(`/crm/clients/${client.id}`);
                }}
            />

            <MergeSheet
                open={showMergeDialog}
                clients={clients.filter(c => mergeSelected.includes(c.id))}
                onConfirm={onMergeConfirm}
                onCancel={() => setShowMergeDialog(false)}
            />
        </div>
    );
}


// ── Таблица ──────────────────────────────────────────────────────────────────

const COLS = 'minmax(180px, 1.4fr) 150px 110px 110px minmax(140px, 1fr) 90px 110px 40px';
const COLS_MERGE = `40px ${COLS}`;
const TABLE_MIN = 1040;

const head: CSSProperties = {
    fontFamily: GH_MONO, fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.06em', color: GH.ink60,
};

function ClientsTable({
    rows, mergeMode, mergeSelected, setMergeSelected, sortField, sortDir, toggleSort, canDeleteForever, onPermanentDelete,
}: {
    rows: CrmClient[];
    mergeMode: boolean;
    mergeSelected: string[];
    setMergeSelected: React.Dispatch<React.SetStateAction<string[]>>;
    sortField: SortField;
    sortDir: SortDir;
    toggleSort: (f: SortField) => void;
    canDeleteForever: boolean;
    onPermanentDelete: (client: CrmClient) => Promise<void>;
}) {
    const cols = mergeMode ? COLS_MERGE : COLS;
    const sortProps = { current: sortField, dir: sortDir, onSort: toggleSort };
    const toggleSelected = (id: string) =>
        setMergeSelected(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);

    return (
        <div style={{ border: `1px solid ${GH.ink10}`, overflowX: 'auto' }}>
            <div style={{ display: 'grid', gridTemplateColumns: cols, columnGap: 12, borderBottom: `1px solid ${GH.ink10}`, padding: '10px 20px', minWidth: TABLE_MIN, alignItems: 'center' }}>
                {mergeMode && <div aria-hidden="true" />}
                <GHSortHeader field="name" {...sortProps}>Имя</GHSortHeader>
                <GHSortHeader field="nextSessionDate" {...sortProps}>Следующая</GHSortHeader>
                <GHSortHeader field="lastPastSessionDate" {...sortProps}>Была</GHSortHeader>
                {/* Долг — рядом с датами: главный вопрос «кто должен» без скролла вбок. */}
                <GHSortHeader field="unpaidSum" {...sortProps}>Долг</GHSortHeader>
                <div style={head}>Контакты</div>
                <GHSortHeader field="basePrice" {...sortProps}>Ставка</GHSortHeader>
                <GHSortHeader field="totalPaid" {...sortProps}>Оплачено</GHSortHeader>
                <div aria-hidden="true" />
            </div>

            {rows.map((client, i) => {
                const c = client as any;
                const isSelected = mergeSelected.includes(client.id);
                const isInactive = !client.isActive;
                const hasPast = !!client.lastPastSessionDate || (c.sessionCount || 0) > 0;
                const rowStyle: CSSProperties = {
                    position: 'relative',
                    display: 'grid', gridTemplateColumns: cols, columnGap: 12,
                    padding: '14px 20px', alignItems: 'center', minWidth: TABLE_MIN,
                    borderBottom: i === rows.length - 1 ? 'none' : `1px solid ${GH.ink10}`,
                    background: isSelected ? GH.ink5 : 'transparent',
                    // Тех, кто на паузе, приглушаем цветом, не прозрачностью (X4-19).
                    color: isInactive ? GH.ink60 : GH.ink,
                    fontSize: 14, cursor: 'pointer', transition: 'background 0.12s ease',
                };
                const hover = {
                    onMouseEnter: (e: React.MouseEvent<HTMLElement>) => { if (!isSelected) e.currentTarget.style.background = GH.ink5; },
                    onMouseLeave: (e: React.MouseEvent<HTMLElement>) => { if (!isSelected) e.currentTarget.style.background = 'transparent'; },
                };

                const nameCell: ReactNode = (
                    <div style={{ minWidth: 0 }}>
                        <div style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {mergeMode ? client.name : (
                                // Ссылка растянута на всю строку (::after-приём через span):
                                // строка открывается кликом, Tab и Enter, а кнопки справа
                                // остаются отдельными кнопками, не вложенными в ссылку.
                                <Link to={`/crm/clients/${client.id}`} style={{ color: 'inherit', textDecoration: 'none' }}>
                                    {client.name}
                                    <span aria-hidden="true" style={{ position: 'absolute', inset: 0 }} />
                                </Link>
                            )}
                        </div>
                        {(client.aliasCode || isInactive) && (
                            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 2, fontSize: 12, color: GH.ink60 }}>
                                {client.aliasCode && <span style={{ fontFamily: GH_MONO }}>#{client.aliasCode}</span>}
                                {isInactive && (
                                    <span style={{ padding: '0 6px', borderRadius: 8, background: STATUS.muted.bg, color: STATUS.muted.fg, fontWeight: 600 }}>
                                        На паузе
                                    </span>
                                )}
                            </div>
                        )}
                    </div>
                );

                const cells = (
                    <>
                        {nameCell}

                        {/* Следующая */}
                        <div className="num" style={{ fontSize: 13 }}>
                            {client.nextSessionDate
                                ? nextLabel(client.nextSessionDate)
                                : client.isActive && hasPast
                                    ? <span style={{ color: STATUS.pending.fg, fontFamily: GH_SANS, fontWeight: 500 }}>Не записан</span>
                                    : <span style={{ color: GH.ink60 }}>—</span>}
                        </div>

                        {/* Была */}
                        <div className="num" style={{ fontSize: 13, color: GH.ink60 }}>
                            {client.lastPastSessionDate
                                ? formatDayMonthShort(parseUTC(client.lastPastSessionDate), { withYear: 'auto', ...TZ })
                                : '—'}
                        </div>

                        {/* Долг */}
                        <div style={{ fontSize: 13 }}>
                            {(c.unpaidSum || 0) > 0 ? (
                                <span className="num" style={{ color: GH.danger, fontWeight: 600 }}>
                                    {formatMoney(c.unpaidSum, { currency: client.currency })}
                                </span>
                            ) : (c.sessionCount || 0) > 0 ? (
                                <StatusBadge kind="payment" status="paid" audience="staff" variant="dot" />
                            ) : (
                                <span style={{ color: GH.ink60 }}>—</span>
                            )}
                        </div>

                        {/* Контакты */}
                        <div style={{ fontSize: 13, color: GH.ink60, display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                            {client.telegram && <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center', overflow: 'hidden', textOverflow: 'ellipsis' }}><Send size={12} aria-hidden="true" />@{client.telegram.replace(/^@/, '')}</span>}
                            {client.phone && <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}><Phone size={12} aria-hidden="true" />{client.phone}</span>}
                            {!client.telegram && !client.phone && client.email && <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center', overflow: 'hidden', textOverflow: 'ellipsis' }}><Mail size={12} aria-hidden="true" />{client.email}</span>}
                            {!client.telegram && !client.phone && !client.email && <span>—</span>}
                        </div>

                        {/* Ставка */}
                        <div className="num" style={{ fontSize: 13 }}>
                            {formatMoney(client.basePrice || 0, { currency: client.currency })}
                        </div>

                        {/* Оплачено всего — сумма реальных платежей во всех валютах
                            клиента, поэтому без знака валюты. */}
                        <div
                            className="num"
                            style={{ fontSize: 13, color: (c.totalPaid || 0) > 0 ? GH.ink : GH.ink60 }}
                            title="Сумма всех полученных платежей (во всех валютах клиента)"
                        >
                            {((c as any).totalPaid || 0).toLocaleString('ru-RU')}
                        </div>
                    </>
                );

                if (mergeMode) {
                    return (
                        <label key={client.id} style={rowStyle} {...hover}>
                            <input
                                type="checkbox"
                                checked={isSelected}
                                onChange={() => toggleSelected(client.id)}
                                aria-label={`Выбрать ${client.name} для слияния`}
                                style={{ width: 16, height: 16, accentColor: GH.ink, margin: 0 }}
                            />
                            {cells}
                            <div />
                        </label>
                    );
                }

                return (
                    <div key={client.id} style={rowStyle} {...hover}>
                        {cells}
                        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                            {canDeleteForever && (
                                <button
                                    onClick={() => onPermanentDelete(client)}
                                    title="Удалить навсегда"
                                    aria-label={`Удалить ${client.name} навсегда`}
                                    style={{
                                        position: 'relative', zIndex: 1,
                                        background: 'none', border: 'none', cursor: 'pointer',
                                        width: 32, height: 32, color: GH.ink60,
                                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    }}
                                    onMouseEnter={e => (e.currentTarget.style.color = GH.danger)}
                                    onMouseLeave={e => (e.currentTarget.style.color = GH.ink60)}
                                >
                                    <Trash2 size={14} aria-hidden="true" />
                                </button>
                            )}
                        </div>
                    </div>
                );
            })}
        </div>
    );
}

// ── Заголовок колонки с сортировкой ──
function GHSortHeader({
    field, current, dir, onSort, children,
}: {
    field: SortField;
    current: SortField;
    dir: SortDir;
    onSort: (f: SortField) => void;
    children: ReactNode;
}) {
    const active = current === field;
    return (
        <button
            onClick={() => onSort(field)}
            style={{
                ...head,
                background: 'none', border: 'none', cursor: 'pointer', padding: 0, minHeight: 32,
                textAlign: 'left', color: active ? GH.ink : GH.ink60, fontWeight: active ? 600 : 400,
                display: 'flex', alignItems: 'center', gap: 4,
            }}
        >
            {children}
            {active && <span aria-hidden="true">{dir === 'asc' ? '↑' : '↓'}</span>}
            {active && <span className="sr-only">{dir === 'asc' ? ', по возрастанию' : ', по убыванию'}</span>}
        </button>
    );
}


// ── Слияние карточек — на общем Sheet ────────────────────────────────────────

type MergeOverrides = { name?: string; phone?: string; email?: string; telegram?: string };

const choice = (on: boolean): CSSProperties => ({
    display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px', minHeight: 44,
    border: `1px solid ${on ? GH.accent : GH.ink10}`, background: on ? 'var(--color-accent-soft)' : GH.card,
    borderRadius: 8, cursor: 'pointer', fontSize: 14,
});

function ChoiceGroup({ legend, hint, children }: { legend: string; hint?: string; children: ReactNode }) {
    return (
        <fieldset style={{ border: 'none', padding: 0, margin: 0 }}>
            <legend style={{ fontSize: 14, fontWeight: 600, marginBottom: hint ? 2 : 8, padding: 0 }}>{legend}</legend>
            {hint && <p style={{ fontSize: 13, color: GH.ink60, margin: '0 0 8px' }}>{hint}</p>}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>{children}</div>
        </fieldset>
    );
}

function MergeSheet({
    open, clients, onConfirm, onCancel,
}: {
    open: boolean;
    clients: CrmClient[];
    onConfirm: (targetId: string, overrides: MergeOverrides) => Promise<void>;
    onCancel: () => void;
}) {
    const [targetId, setTargetId] = useState('');
    const [nameSource, setNameSource] = useState('');
    const [phoneSource, setPhoneSource] = useState('');
    const [emailSource, setEmailSource] = useState('');
    const [telegramSource, setTelegramSource] = useState('');
    const [saving, setSaving] = useState(false);

    // Открыли окно — с чистого листа: основная и имя — первая карточка.
    useEffect(() => {
        if (!open) return;
        setTargetId(clients[0]?.id ?? '');
        setNameSource(clients[0]?.id ?? '');
        setPhoneSource('');
        setEmailSource('');
        setTelegramSource('');
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open]);

    const allPhones = [...new Set(clients.map(c => c.phone).filter(Boolean) as string[])];
    const allEmails = [...new Set(clients.map(c => c.email).filter(Boolean) as string[])];
    const allTelegrams = [...new Set(clients.map(c => c.telegram).filter(Boolean) as string[])];
    const selectedName = clients.find(c => c.id === nameSource)?.name ?? clients[0]?.name ?? '';
    const removed = Math.max(0, clients.length - 1);

    const handleConfirm = async () => {
        setSaving(true);
        try {
            await onConfirm(targetId, {
                name: selectedName,
                phone: phoneSource || undefined,
                email: emailSource || undefined,
                telegram: telegramSource || undefined,
            });
        } finally {
            setSaving(false);
        }
    };

    const contactGroup = (legend: string, name: string, values: string[], value: string, set: (v: string) => void, icon: ReactNode) =>
        values.length > 0 && (
            <ChoiceGroup legend={legend}>
                {values.map(v => (
                    <label key={v} style={choice(value === v)}>
                        <input type="radio" name={name} checked={value === v} onChange={() => set(v)} />
                        <span style={{ color: GH.ink60, display: 'flex' }} aria-hidden="true">{icon}</span>
                        <span>{v}</span>
                    </label>
                ))}
            </ChoiceGroup>
        );

    return (
        <Sheet
            open={open}
            onClose={onCancel}
            title="Объединить карточки"
            description={`${ruCountWord(clients.length, ['карточка', 'карточки', 'карточек'])} одного человека → одна`}
            width={560}
            footer={
                <>
                    <Button variant="danger" loading={saving} disabled={!targetId} icon={<Merge size={16} aria-hidden="true" />} onClick={handleConfirm}>
                        Объединить карточки
                    </Button>
                    <Button variant="secondary" onClick={onCancel}>Оставить как есть</Button>
                </>
            }
        >
            <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
                <ChoiceGroup legend="Основная карточка" hint="Все сессии, платежи и заметки перенесём сюда. Остальные карточки удалятся.">
                    {clients.map(c => (
                        <label key={c.id} style={choice(targetId === c.id)}>
                            <input type="radio" name="mergeTarget" checked={targetId === c.id} onChange={() => setTargetId(c.id)} />
                            <span style={{ flex: 1, minWidth: 0 }}>
                                <span style={{ display: 'block', fontWeight: 600 }}>{c.name}{c.aliasCode ? ` #${c.aliasCode}` : ''}</span>
                                <span style={{ display: 'block', fontSize: 13, color: GH.ink60 }}>
                                    {[c.phone, c.telegram, c.email].filter(Boolean).join(' · ') || 'Нет контактов'}
                                </span>
                            </span>
                            {(c as any).sessionCount > 0 && (
                                <span style={{ fontSize: 12, color: GH.ink60, whiteSpace: 'nowrap' }}>
                                    {ruCountWord((c as any).sessionCount, SESSIONS)}
                                </span>
                            )}
                        </label>
                    ))}
                </ChoiceGroup>

                <ChoiceGroup legend="Имя в карточке">
                    {clients.map(c => (
                        <label key={c.id} style={choice(nameSource === c.id)}>
                            <input type="radio" name="mergeName" checked={nameSource === c.id} onChange={() => setNameSource(c.id)} />
                            <span>{c.name}</span>
                        </label>
                    ))}
                </ChoiceGroup>

                {contactGroup('Телефон', 'mergePhone', allPhones, phoneSource, setPhoneSource, <Phone size={14} />)}
                {contactGroup('E-mail', 'mergeEmail', allEmails, emailSource, setEmailSource, <Mail size={14} />)}
                {contactGroup('Telegram', 'mergeTelegram', allTelegrams, telegramSource, setTelegramSource, <Send size={14} />)}

                <p style={{ margin: 0, padding: 12, borderRadius: 8, background: STATUS.danger.bg, color: STATUS.danger.fg, fontSize: 14 }}>
                    {removed > 0 && <>Удалятся {ruCountWord(removed, ['карточка', 'карточки', 'карточек'])}. </>}
                    Сессии, платежи и заметки перенесём в основную. Отменить объединение нельзя.
                </p>
            </div>
        </Sheet>
    );
}
