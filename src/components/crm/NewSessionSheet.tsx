import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { toast } from 'sonner';
import { AlertTriangle } from 'lucide-react';
import { Sheet } from '../ui/Sheet';
import { Button } from '../ui/Button';
import { Chip } from '../ui/Chip';
import { Field, Input } from '../ui/Field';
import { crmApi, type CrmClient, type CrmSession } from '../../api/crm';
import { specialistsApi } from '../../api/specialists';
import { useCrmStore } from '../../store/crmStore';
import { useUserStore } from '../../store/userStore';
import { toastApiError } from '../../utils/errors';
import {
    formatDateLabel, formatDayMonth, formatDayMonthShort, formatMoney, formatWeekdayShort,
} from '../../utils/format';
import {
    addDaysYmd, suggestNextSession, tbilisiWallClock, toTbilisiNaive, utcNaiveToTbilisi,
} from '../../utils/crmNextSession';

/**
 * NewSessionSheet — «Записать сессию» (волна 3, шаг 0). Одна шторка для
 * телефона и компьютера: «Записать следующую» из шторки сессии, «+ Сессия»
 * на «Сегодня», «Новая сессия» в карточке клиента, «Без следующей встречи».
 *
 *   <NewSessionSheet open={open} onClose={…} client={client} lastSession={s}
 *                    onCreated={(session) => …} />
 *
 * - client передан → клиент зафиксирован; нет — поиск по своим клиентам.
 * - Чипы «+1 нед · +2 нед · Другая дата»: тот же день недели и время, что у
 *   прошлой сессии (suggestNextSession), длительность и цена — оттуда же.
 * - Мягкие предупреждения (записать всё равно можно): «В это время уже …»
 *   (сессии дня через crmApi.getSessions) и «Вы в отпуске до …».
 * - «Добавить в Google Календарь» (решение В3) — только если календарь
 *   подключён (settings.calendarId), по умолчанию включено; уходит
 *   существующим pushToCalendar у POST /crm/sessions.
 * - Пишет ТОЛЬКО createSession: без заметок (они шифруются и живут в
 *   createNote) и без чужого специалиста. Дата — naive по Батуми.
 * - После успеха — onCreated(session); обновить список — дело родителя.
 */
export interface NewSessionSheetProps {
    open: boolean;
    onClose: () => void;
    onCreated: (session: CrmSession) => void;
    /** Клиент зафиксирован. Нет — поиск по своим клиентам. */
    client?: CrmClient | null;
    /** Список для поиска. Нет — берём из стора, там пусто — загрузим сами. */
    clients?: CrmClient[];
    /** Прошлая сессия клиента — от неё «+1 нед». undefined — найдём сами,
     *  null — истории нет (считаем от сегодня). */
    lastSession?: CrmSession | null;
    /** Длительность из анкеты (sessionDurationMin). Нет — спросим анкету. */
    profileDurationMin?: number | null;
    /** false — без тоста «Записали…»: родитель покажет свой (например, с
     *  действием «Забронировать кабинет»). По умолчанию true. */
    successToast?: boolean;
}

type DateMode = 'w1' | 'w2' | 'custom';

const CANCELLED = new Set(['CANCELLED_CLIENT', 'CANCELLED_THERAPIST']);

function toMinutes(time: string): number {
    const [h, m] = time.split(':').map(Number);
    return (h || 0) * 60 + (m || 0);
}

function currencySuffix(code: string): string {
    return formatMoney(0, { currency: code }).replace(/^0[\s ]*/, '');
}

/** «вт, 7 окт.» — коротко для кнопки. */
function shortDay(ymd: string): string {
    return `${formatWeekdayShort(ymd, { capitalize: false })}, ${formatDayMonthShort(ymd)}`;
}

/** Последняя прошедшая (не отменённая) сессия из списка. */
function pickLastPast(list: CrmSession[], now = Date.now()): CrmSession | null {
    let best: CrmSession | null = null;
    let bestT = -Infinity;
    for (const s of list) {
        if (CANCELLED.has(s.status)) continue;
        const t = new Date(/Z$|[+-]\d{2}:?\d{2}$/.test(s.date) ? s.date : `${s.date}Z`).getTime();
        if (t <= now && t > bestT) { best = s; bestT = t; }
    }
    return best;
}

const warnStyle: CSSProperties = {
    display: 'flex', gap: 8, alignItems: 'flex-start',
    padding: '10px 12px', borderRadius: 'var(--radius-control)',
    background: 'var(--status-pending-bg)', color: 'var(--status-pending-fg)',
    fontSize: 'var(--text-small)', lineHeight: 1.4,
};

export function NewSessionSheet({
    open, onClose, onCreated, client: fixedClient, clients: clientsProp, lastSession: lastProp, profileDurationMin,
    successToast = true,
}: NewSessionSheetProps) {
    const storeClients = useCrmStore(s => s.clients);
    const viewingOther = useCrmStore(s => !!s.viewAsSpecialistId);
    const currentUser = useUserStore(s => s.currentUser) as unknown as
        { crmData?: { vacationUntil?: string | null }; crm_data?: { vacation_until?: string | null } } | null;

    const [loadedClients, setLoadedClients] = useState<CrmClient[] | null>(null);
    const [picked, setPicked] = useState<CrmClient | null>(null);
    const [query, setQuery] = useState('');
    const [last, setLast] = useState<CrmSession | null | undefined>(undefined);
    const [profileDur, setProfileDur] = useState<number | null | undefined>(profileDurationMin);
    const [mode, setMode] = useState<DateMode>('w1');
    const [date, setDate] = useState('');
    const [time, setTime] = useState('');
    const [duration, setDuration] = useState('60');
    const [price, setPrice] = useState('');
    const [calendarConnected, setCalendarConnected] = useState(false);
    const [pushCal, setPushCal] = useState(true);
    const [daySessions, setDaySessions] = useState<CrmSession[] | null>(null);
    const [errors, setErrors] = useState<{ client?: string; date?: string; time?: string; duration?: string; price?: string }>({});
    const [saving, setSaving] = useState(false);
    const savingRef = useRef(false);
    const dayCache = useRef(new Map<string, CrmSession[]>());

    const client = fixedClient ?? picked;
    const allClients = clientsProp ?? (storeClients.length ? storeClients : loadedClients ?? []);

    // ── Открыли шторку — всё с чистого листа ────────────────────────────
    useEffect(() => {
        if (!open) return;
        setPicked(null);
        setQuery('');
        setMode('w1');
        setErrors({});
        setPushCal(true);
        setDaySessions(null);
        dayCache.current.clear();
        setLast(fixedClient ? lastProp : null);
        let alive = true;
        crmApi.getSettings()
            .then(s => { if (alive) setCalendarConnected(!!s.calendarId); })
            .catch(() => { if (alive) setCalendarConnected(false); });
        if (!clientsProp && !storeClients.length && !fixedClient) {
            crmApi.getClients(true).then(list => { if (alive) setLoadedClients(list); }).catch(() => {});
        }
        return () => { alive = false; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open]);

    // Длительность из анкеты — только если её не передали.
    useEffect(() => {
        if (!open || profileDurationMin != null) { setProfileDur(profileDurationMin); return; }
        let alive = true;
        specialistsApi.getMine()
            .then(p => { if (alive) setProfileDur((p as { sessionDurationMin?: number } | null)?.sessionDurationMin ?? null); })
            .catch(() => { if (alive) setProfileDur(null); });
        return () => { alive = false; };
    }, [open, profileDurationMin]);

    // Прошлая сессия: передали — берём её, иначе ищем у выбранного клиента.
    useEffect(() => {
        if (!open || !client) return;
        if (fixedClient && lastProp !== undefined) { setLast(lastProp); return; }
        let alive = true;
        setLast(undefined);
        crmApi.getSessions({ clientId: client.id })
            .then(list => { if (alive) setLast(pickLastPast(list)); })
            .catch(() => { if (alive) setLast(null); });
        return () => { alive = false; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open, client?.id, lastProp]);

    // Предложение «+1 нед» — как только знаем клиента, прошлую сессию и анкету.
    const suggestion = useMemo(() => {
        if (!client || last === undefined) return null;
        return {
            w1: suggestNextSession({ lastSession: last, client, profileDurationMin: profileDur, weeks: 1 }),
            w2: suggestNextSession({ lastSession: last, client, profileDurationMin: profileDur, weeks: 2 }),
        };
        // Зависим от полей клиента, а не от объекта: родитель может каждый
        // рендер отдавать новый объект — правки пользователя не сбрасываем.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [client?.id, client?.basePrice, client?.currency, last, profileDur]);

    useEffect(() => {
        if (!suggestion) return;
        setMode('w1');
        setDate(suggestion.w1.date);
        setTime(suggestion.w1.time);
        setDuration(String(suggestion.w1.durationMinutes));
        setPrice(suggestion.w1.price ? String(suggestion.w1.price) : '');
    }, [suggestion]);

    const chooseMode = (m: DateMode) => {
        setMode(m);
        setErrors(e => ({ ...e, date: undefined }));
        if (m !== 'custom' && suggestion) setDate(suggestion[m].date);
    };

    // ── Сессии выбранного дня — для «в это время уже …» ─────────────────
    useEffect(() => {
        if (!open || !/^\d{4}-\d{2}-\d{2}$/.test(date)) { setDaySessions(null); return; }
        const cached = dayCache.current.get(date);
        if (cached) { setDaySessions(cached); return; }
        let alive = true;
        // В базе UTC: день по Батуми начинается накануне в 20:00 UTC —
        // берём два дня и оставляем свой день по Батуми.
        crmApi.getSessions({ dateFrom: addDaysYmd(date, -1), dateTo: date })
            .then(list => {
                const mine = list.filter(s => !CANCELLED.has(s.status) && utcNaiveToTbilisi(s.date)?.date === date);
                dayCache.current.set(date, mine);
                if (alive) setDaySessions(mine);
            })
            .catch(() => { if (alive) setDaySessions(null); });
        return () => { alive = false; };
    }, [open, date]);

    const durationNum = Number(duration);
    const overlaps = useMemo(() => {
        if (!daySessions || !/^\d{1,2}:\d{2}$/.test(time)) return [];
        const start = toMinutes(time);
        const end = start + (Number.isFinite(durationNum) && durationNum > 0 ? durationNum : 60);
        const names = new Map(allClients.map(c => [c.id, c.name]));
        return daySessions
            .map(s => {
                const w = utcNaiveToTbilisi(s.date);
                if (!w) return null;
                const sStart = toMinutes(w.time);
                const sEnd = sStart + (s.durationMinutes || 60);
                if (sStart >= end || sEnd <= start) return null;
                const e = sEnd % (24 * 60);
                const endLabel = `${String(Math.floor(e / 60)).padStart(2, '0')}:${String(e % 60).padStart(2, '0')}`;
                return `${names.get(s.clientId) ?? 'другая сессия'} · ${w.time}–${endLabel}`;
            })
            .filter((x): x is string => !!x);
    }, [daySessions, time, durationNum, allClients]);

    const vacationUntil = currentUser?.crmData?.vacationUntil ?? currentUser?.crm_data?.vacation_until ?? null;
    const today = tbilisiWallClock(new Date())?.date ?? '';
    const onVacation = !!vacationUntil && !!date && vacationUntil >= today && date <= vacationUntil;
    const nowWall = tbilisiWallClock(new Date());
    const inPast = !!date && !!time && !!nowWall && `${date} ${time.padStart(5, '0')}` < `${nowWall.date} ${nowWall.time}`;

    // ── Поиск клиента ───────────────────────────────────────────────────
    const matches = useMemo(() => {
        if (fixedClient || picked) return [];
        const q = query.trim().toLowerCase().replace(/^#/, '');
        const active = allClients.filter(c => c.isActive !== false);
        const list = q
            ? active.filter(c => c.name.toLowerCase().includes(q) || (c.aliasCode || '').includes(q))
            : active;
        return list.slice(0, 6);
    }, [allClients, query, fixedClient, picked]);

    const currency = (client?.currency || 'GEL').toUpperCase();
    const validTime = /^\d{1,2}:\d{2}$/.test(time);
    const validDate = /^\d{4}-\d{2}-\d{2}$/.test(date);

    const submit = async () => {
        if (savingRef.current) return;
        const next: typeof errors = {};
        if (!client) next.client = 'Выберите клиента';
        if (!validDate) next.date = 'Выберите дату';
        if (!validTime) next.time = 'Укажите время, например 19:00';
        const dur = Math.round(Number(duration));
        if (!Number.isFinite(dur) || dur < 10 || dur > 600) next.duration = 'Длительность от 10 до 600 минут';
        // Пусто — цену не ставим: сервер возьмёт ставку клиента при оплате.
        const priceNum = price.trim() === '' ? undefined : Number(price.replace(',', '.'));
        if (priceNum !== undefined && (!Number.isFinite(priceNum) || priceNum < 0)) next.price = 'Введите цену числом, например 140';
        setErrors(next);
        if (Object.keys(next).length || !client) return;

        let naive: string;
        try { naive = toTbilisiNaive(date, time); } catch (e) {
            setErrors({ time: (e as Error).message });
            return;
        }
        savingRef.current = true;
        setSaving(true);
        try {
            const session = await crmApi.createSession({
                clientId: client.id,
                date: naive,
                durationMinutes: dur,
                price: priceNum,
                pushToCalendar: calendarConnected && pushCal,
            });
            if (successToast) toast.success(`Записали: ${client.name}, ${shortDay(date)}, ${time}`);
            onCreated(session);
            onClose();
        } catch (e) {
            toastApiError(e, 'Не удалось записать сессию');
        } finally {
            savingRef.current = false;
            setSaving(false);
        }
    };

    const canSubmit = !!client && validDate && validTime && !viewingOther;
    const submitLabel = validDate && validTime ? `Записать на ${shortDay(date)}, ${time}` : 'Записать сессию';

    return (
        <Sheet
            open={open}
            onClose={() => { if (!saving) onClose(); }}
            title="Новая сессия"
            description={client ? client.name : undefined}
            width={480}
            footer={(
                <>
                    <Button block loading={saving} disabled={!canSubmit} onClick={submit}>
                        {submitLabel}
                    </Button>
                    <Button block variant="secondary" disabled={saving} onClick={onClose}>
                        Не записывать
                    </Button>
                </>
            )}
        >
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                {viewingOther && (
                    <div role="status" style={warnStyle}>
                        <AlertTriangle size={16} aria-hidden="true" style={{ flexShrink: 0, marginTop: 2 }} />
                        <span>Вы смотрите чужой кабинет — записывать сессии здесь нельзя.</span>
                    </div>
                )}

                {/* Клиент */}
                {!fixedClient && (
                    picked ? (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 12, minHeight: 44 }}>
                            <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ fontSize: 'var(--text-small)', color: 'var(--color-ink-60)' }}>Клиент</div>
                                <div style={{ fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                    {picked.name}{picked.aliasCode ? ` #${picked.aliasCode}` : ''}
                                </div>
                            </div>
                            <Button variant="quiet" onClick={() => { setPicked(null); setLast(null); }}>Сменить</Button>
                        </div>
                    ) : (
                        <Field label="Клиент" error={errors.client}>
                            <Input
                                kind="search"
                                value={query}
                                onChange={e => setQuery(e.target.value)}
                                placeholder="Имя или код"
                            />
                        </Field>
                    )
                )}
                {!fixedClient && !picked && (
                    <div role="list" aria-label="Клиенты" style={{ display: 'flex', flexDirection: 'column', marginTop: -8 }}>
                        {matches.length === 0 ? (
                            <div style={{ fontSize: 'var(--text-small)', color: 'var(--color-ink-60)', padding: '8px 0' }}>
                                {query.trim() ? 'Никого не нашли — проверьте имя или код' : 'Клиентов пока нет'}
                            </div>
                        ) : matches.map(c => (
                            <button
                                key={c.id}
                                type="button"
                                role="listitem"
                                onClick={() => { setPicked(c); setErrors(e => ({ ...e, client: undefined })); }}
                                style={{
                                    display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
                                    minHeight: 44, padding: '0 4px', textAlign: 'left', background: 'none',
                                    border: 0, borderBottom: '1px solid var(--color-ink-10)', color: 'var(--color-ink)',
                                    fontSize: 'var(--text-body)', cursor: 'pointer',
                                }}
                            >
                                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</span>
                                {c.aliasCode && <span className="num" style={{ color: 'var(--color-ink-60)', fontSize: 'var(--text-small)' }}>#{c.aliasCode}</span>}
                            </button>
                        ))}
                    </div>
                )}

                {client && (
                    <>
                        {/* Когда */}
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                            <div className="ui-chip-row" role="group" aria-label="Когда">
                                <Chip selected={mode === 'w1'} disabled={!suggestion} onClick={() => chooseMode('w1')}>+1 нед</Chip>
                                <Chip selected={mode === 'w2'} disabled={!suggestion} onClick={() => chooseMode('w2')}>+2 нед</Chip>
                                <Chip selected={mode === 'custom'} onClick={() => chooseMode('custom')}>Другая дата</Chip>
                            </div>
                            {mode !== 'custom' && validDate && (
                                <div style={{ fontSize: 'var(--text-small)', color: 'var(--color-ink-60)' }}>
                                    {formatDateLabel(date, { capitalize: true, withYear: 'auto' })}
                                    {suggestion?.w1.fromLastSession ? ' · как в прошлый раз' : ''}
                                </div>
                            )}
                        </div>
                        {mode === 'custom' && (
                            <Field label="Дата" error={errors.date}>
                                <Input kind="date" value={date} onChange={e => setDate(e.target.value)} />
                            </Field>
                        )}

                        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)', gap: 12 }}>
                            <Field label="Время" error={errors.time}>
                                <Input kind="time" step={300} value={time} onChange={e => setTime(e.target.value)} />
                            </Field>
                            <Field label="Длительность" error={errors.duration}>
                                <Input kind="integer" suffix="мин" value={duration} onChange={e => setDuration(e.target.value.replace(/\D/g, ''))} />
                            </Field>
                        </div>
                        <Field label="Цена" error={errors.price} hint={price.trim() === '' ? 'Пусто — по ставке клиента' : undefined}>
                            <Input kind="money" suffix={currencySuffix(currency)} value={price} onChange={e => setPrice(e.target.value)} />
                        </Field>

                        {/* Мягкие предупреждения: записать всё равно можно */}
                        {overlaps.length > 0 && (
                            <div role="status" style={warnStyle}>
                                <AlertTriangle size={16} aria-hidden="true" style={{ flexShrink: 0, marginTop: 2 }} />
                                <span>В это время уже: {overlaps.join('; ')}</span>
                            </div>
                        )}
                        {onVacation && vacationUntil && (
                            <div role="status" style={warnStyle}>
                                <AlertTriangle size={16} aria-hidden="true" style={{ flexShrink: 0, marginTop: 2 }} />
                                <span>Вы в отпуске до {formatDayMonth(vacationUntil, { withYear: 'auto' })}</span>
                            </div>
                        )}
                        {inPast && (
                            <div role="status" style={warnStyle}>
                                <AlertTriangle size={16} aria-hidden="true" style={{ flexShrink: 0, marginTop: 2 }} />
                                <span>Это время уже прошло — сессия запишется в прошлое</span>
                            </div>
                        )}

                        {/* В3: календарь — только если подключён */}
                        {calendarConnected && (
                            <label style={{ display: 'flex', alignItems: 'center', gap: 12, minHeight: 44, cursor: 'pointer' }}>
                                <input
                                    type="checkbox"
                                    checked={pushCal}
                                    onChange={e => setPushCal(e.target.checked)}
                                    style={{ width: 20, height: 20, accentColor: 'var(--color-accent)', flexShrink: 0 }}
                                />
                                <span>Добавить в Google Календарь</span>
                            </label>
                        )}
                    </>
                )}
            </div>
        </Sheet>
    );
}
