import { useEffect, useState, type ReactNode } from 'react';
import { Bell, CalendarDays, Inbox, Plus, Search, Wallet } from 'lucide-react';
import { toast } from 'sonner';
import { COLOR, RADIUS, SHADOW, SPACE, STATUS, TEXT } from '../design/tokens';
import { STATUS_DICTIONARY, type StatusKind } from '../design/statuses';
import { Button, type ButtonVariant } from '../components/ui/Button';
import { Sheet } from '../components/ui/Sheet';
import { useConfirmDialog } from '../components/ui/ConfirmDialogProvider';
import { undoToast } from '../components/ui/undoToast';
import { StatusBadge } from '../components/ui/StatusBadge';
import { Field, Input, Select, TextArea } from '../components/ui/Field';
import { Chip, Segmented } from '../components/ui/Chip';
import { Skeleton, SkeletonList, SkeletonText } from '../components/ui/Skeleton';
import { ErrorBar } from '../components/ui/ErrorBar';
import { EmptyState } from '../components/ui/EmptyState';
import { MobilePageHeader, PageHeader } from '../components/ui/PageHeader';
import { Money } from '../components/ui/Money';
import {
    formatDateLabel, formatDayMonth, formatGel, formatMoney, formatMonthLabel, formatTime, formatTimeRange,
} from '../utils/format';

/**
 * /dev/ui — витрина дизайн-системы (только `npm run dev`, в прод не попадает).
 * Все компоненты во всех вариантах: слева «телефон» (плотность touch, 44 px),
 * справа «компьютер» (compact, 36 px). ?open=sheet|confirm — открыть сразу
 * (для снимков).
 */

// ── контраст для таблицы токенов ─────────────────────────────────────────
function parse(c: string): [number, number, number, number] {
    if (c.startsWith('#')) {
        const h = c.slice(1);
        return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16), 1];
    }
    const m = c.match(/rgba?\(([^)]+)\)/);
    const p = (m ? m[1] : '0,0,0,1').split(',').map(s => parseFloat(s));
    return [p[0], p[1], p[2], p[3] ?? 1];
}
function lum([r, g, b]: number[]) {
    const f = (v: number) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
function contrastOn(fg: string, bg: string) {
    const [r, g, b, a] = parse(fg);
    const [R, G, B] = parse(bg);
    const mix = [a * r + (1 - a) * R, a * g + (1 - a) * G, a * b + (1 - a) * B];
    const l1 = lum(mix), l2 = lum([R, G, B]);
    return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

const H2 = ({ children }: { children: ReactNode }) => (
    <h2 style={{ fontSize: TEXT.title, fontWeight: 600, lineHeight: 1.2, margin: `${SPACE[6]}px 0 ${SPACE[3]}px` }}>{children}</h2>
);
const Label = ({ children }: { children: ReactNode }) => (
    <div style={{ fontSize: TEXT.caption, color: COLOR.ink60, margin: `${SPACE[3]}px 0 ${SPACE[2]}px` }}>{children}</div>
);
const Row = ({ children }: { children: ReactNode }) => (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: SPACE[2], alignItems: 'center' }}>{children}</div>
);

const VARIANTS: ButtonVariant[] = ['primary', 'secondary', 'quiet', 'danger'];
const VARIANT_LABEL: Record<ButtonVariant, string> = {
    primary: 'Пополнить на 20 ₾', secondary: 'Оставить', quiet: 'Подробнее', danger: 'Отменить 6 броней',
};

function Components({ id }: { id: string }) {
    const { confirm } = useConfirmDialog();
    const [sheetOpen, setSheetOpen] = useState(false);
    const [chips, setChips] = useState<string[]>(['one']);
    const [period, setPeriod] = useState<'day' | 'week' | 'month'>('week');
    const [amount, setAmount] = useState('20');
    const [busy, setBusy] = useState(false);

    useEffect(() => {
        const open = new URLSearchParams(window.location.search).get('open');
        if (id !== 'touch') return;
        if (open === 'sheet') setSheetOpen(true);
        if (open === 'confirm') void askDanger();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const askDanger = async () => {
        const ok = await confirm({
            title: 'Отменить серию?',
            body: 'Отменим 6 будущих броней по вторникам. 120 ₾ вернём на баланс сразу.',
            confirmLabel: 'Отменить 6 броней',
            cancelLabel: 'Оставить',
            tone: 'danger',
        });
        if (ok) undoToast('Серия отменена', () => { toast.success('Серия восстановлена'); });
    };
    const askPlain = async () => {
        const ok = await confirm({
            title: 'Отметить 3 сессии оплаченными?',
            body: 'Оплата запишется сегодняшним числом.',
            confirmLabel: 'Отметить оплату',
            cancelLabel: 'Не сейчас',
        });
        if (ok) toast.success('Оплата отмечена');
    };
    const toggle = (v: string) => setChips(c => (c.includes(v) ? c.filter(x => x !== v) : [...c, v]));
    const amountError = amount.trim() === '' || Number(amount.replace(',', '.')) <= 0 ? 'Введите сумму больше 0 ₾' : undefined;

    return (
        <div>
            <H2>Button</H2>
            {VARIANTS.map(v => (
                <div key={v}>
                    <Label>{v}</Label>
                    <Row>
                        <Button variant={v}>{VARIANT_LABEL[v]}</Button>
                        <Button variant={v} disabled>Недоступно</Button>
                        <Button variant={v} loading>Сохраняем</Button>
                    </Row>
                </div>
            ))}
            <Label>со значком · во всю ширину · только значок</Label>
            <Row>
                <Button icon={<Plus size={18} aria-hidden="true" />}>Новая бронь</Button>
                <Button variant="secondary" icon={<Search size={18} aria-hidden="true" />} aria-label="Поиск" />
            </Row>
            <div style={{ marginTop: SPACE[2] }}>
                <Button block loading={busy} onClick={() => { setBusy(true); setTimeout(() => setBusy(false), 1500); }}>
                    Оплатить 90 ₾
                </Button>
            </div>

            <H2>Sheet · ConfirmDialog · «Вернуть»</H2>
            <Row>
                <Button variant="secondary" onClick={() => setSheetOpen(true)}>Открыть шторку</Button>
                <Button variant="secondary" onClick={askDanger}>Подтвердить: опасно</Button>
                <Button variant="secondary" onClick={askPlain}>Подтвердить: обычное</Button>
                <Button variant="quiet" onClick={() => undoToast('Заметка удалена', () => { toast('Вернули заметку'); })}>
                    Показать «Вернуть»
                </Button>
            </Row>

            <H2>Chip · Segmented</H2>
            <div className="ui-chip-row" role="group" aria-label="Филиал">
                <Chip selected={chips.includes('one')} onClick={() => toggle('one')}>Unbox One</Chip>
                <Chip selected={chips.includes('uni')} onClick={() => toggle('uni')}>Unbox Uni</Chip>
                <Chip selected={chips.includes('group')} onClick={() => toggle('group')}>Группа</Chip>
                <Chip disabled>Капсула</Chip>
            </div>
            <div style={{ marginTop: SPACE[3] }}>
                <Segmented
                    aria-label="Период"
                    value={period}
                    onChange={setPeriod}
                    options={[{ value: 'day', label: 'День' }, { value: 'week', label: 'Неделя' }, { value: 'month', label: 'Месяц' }]}
                />
            </div>

            <H2>Field</H2>
            <div style={{ display: 'grid', gap: SPACE[4] }}>
                <Field label="Сумма" hint="Спишем с баланса сразу" error={amountError}>
                    <Input kind="money" value={amount} onChange={e => setAmount(e.target.value)} suffix="₾" />
                </Field>
                <Field label="Телефон" hint="С кодом страны: +995 …">
                    <Input kind="phone" placeholder="+995 599 000 000" />
                </Field>
                <Field label="Почта" error="Похоже, в адресе ошибка — проверьте «@»">
                    <Input kind="email" defaultValue="anna.gmail.com" />
                </Field>
                <Field label="Кабинет">
                    <Select defaultValue="5">
                        <option value="1">Кабинет 1 · Unbox One</option>
                        <option value="5">Кабинет 5 · Unbox Uni</option>
                    </Select>
                </Field>
                <Field label="Комментарий" optional>
                    <TextArea placeholder="Например: нужен флипчарт" />
                </Field>
                <Field label="Недоступное поле">
                    <Input disabled defaultValue="Только для чтения" />
                </Field>
            </div>

            <H2>StatusBadge</H2>
            {(Object.keys(STATUS_DICTIONARY) as StatusKind[]).map(kind => (
                <div key={kind}>
                    <Label>{kind}</Label>
                    <Row>
                        {Object.keys(STATUS_DICTIONARY[kind]).map(code => (
                            <StatusBadge key={code} kind={kind} status={code} />
                        ))}
                        {kind === 'booking' && <StatusBadge kind="booking" status="pending_approval" audience="staff" />}
                        <StatusBadge kind={kind} status="weird_code" />
                    </Row>
                    <div style={{ marginTop: SPACE[2] }}>
                        <Row>
                            {Object.keys(STATUS_DICTIONARY[kind]).map(code => (
                                <StatusBadge key={code} kind={kind} status={code} variant="dot" />
                            ))}
                        </Row>
                    </div>
                </div>
            ))}

            <H2>Skeleton · ErrorBar · EmptyState</H2>
            <SkeletonList count={2} label="Загружаем брони" />
            <div style={{ display: 'flex', gap: SPACE[3], alignItems: 'center', marginTop: SPACE[3] }}>
                <Skeleton width={44} height={44} />
                <div style={{ flex: 1 }}><SkeletonText lines={2} /></div>
            </div>
            <div style={{ display: 'grid', gap: SPACE[2], marginTop: SPACE[4] }}>
                <ErrorBar onRetry={() => toast('Повторяем…')} />
                <ErrorBar onRetry={() => undefined} staleAt={new Date(2026, 8, 30, 14, 5)} message="Не удалось обновить" />
                <ErrorBar onRetry={() => undefined} retrying />
            </div>
            <EmptyState
                icon={<CalendarDays size={28} />}
                title="Будущих броней пока нет"
                hint="Выберите свободное время — это займёт минуту."
                action={{ label: 'Найти время', onClick: () => toast('→ /m/find') }}
            />
            <EmptyState compact icon={<Inbox size={24} />} title="Новых заявок нет" hint="Когда клиент попросит горячую бронь, она появится здесь." />

            <H2>Деньги и даты</H2>
            <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: TEXT.small }}>
                <tbody>
                    {([
                        ['formatGel(1250)', formatGel(1250)],
                        ['formatGel(31.5)', formatGel(31.5)],
                        ['formatGel(16052.004)', formatGel(16052.004)],
                        ['formatGel(-150)', formatGel(-150)],
                        ['formatGel(20, { sign: true })', formatGel(20, { sign: true })],
                        ["formatMoney(35, { currency: 'USD' })", formatMoney(35, { currency: 'USD' })],
                        ['formatGel(null)', formatGel(null)],
                        ['formatDateLabel(29.09.2026)', formatDateLabel(new Date(2026, 8, 29))],
                        ['formatDateLabel(…, { capitalize })', formatDateLabel(new Date(2026, 8, 29), { capitalize: true })],
                        ["formatDayMonth('2026-09-29')", formatDayMonth('2026-09-29')],
                        ["formatDayMonth('2025-12-31', { withYear: 'auto' })", formatDayMonth('2025-12-31', { withYear: 'auto' })],
                        ['formatMonthLabel(сейчас)', formatMonthLabel(new Date())],
                        ["formatTime('14:05:00')", formatTime('14:05:00')],
                        ["formatTimeRange('15:00', '16:30')", formatTimeRange('15:00', '16:30')],
                    ] as const).map(([k, v]) => (
                        <tr key={k} style={{ borderTop: `1px solid ${COLOR.ink10}` }}>
                            <td style={{ padding: `${SPACE[2]}px 0`, color: COLOR.ink60, fontFamily: 'var(--font-mono)', fontSize: TEXT.caption }}>{k}</td>
                            <td style={{ padding: `${SPACE[2]}px 0 ${SPACE[2]}px ${SPACE[3]}px`, textAlign: 'right', whiteSpace: 'nowrap' }} className="num">{v}</td>
                        </tr>
                    ))}
                </tbody>
            </table>
            <div style={{ marginTop: SPACE[3], fontSize: TEXT.body }}>
                Баланс: <Money value={1250} /> · Долг: <Money value={-90} /> · Возврат: <Money value={45} sign />
            </div>

            <Sheet
                open={sheetOpen}
                onClose={() => setSheetOpen(false)}
                title="Пополнить баланс"
                description="Анна Смирнова · сейчас 145 ₾"
                footer={
                    <>
                        <Button block onClick={() => { setSheetOpen(false); toast.success('Баланс пополнен на 20 ₾'); }}>
                            Пополнить на 20 ₾
                        </Button>
                        <Button block variant="secondary" onClick={() => setSheetOpen(false)}>Отмена</Button>
                    </>
                }
            >
                <div style={{ display: 'grid', gap: SPACE[4] }}>
                    <div className="ui-chip-row" role="group" aria-label="Сумма">
                        {[20, 50, 100, 200].map(v => <Chip key={v} selected={v === 20}>{formatGel(v)}</Chip>)}
                    </div>
                    <Field label="Своя сумма" hint="Можно с копейками: 12,5">
                        <Input kind="money" defaultValue="20" suffix="₾" />
                    </Field>
                    <Field label="Способ оплаты">
                        <Select defaultValue="cash">
                            <option value="cash">Наличные</option>
                            <option value="card">Карта</option>
                        </Select>
                    </Field>
                    <Field label="Комментарий" optional>
                        <TextArea placeholder="Например: за сентябрь" />
                    </Field>
                    {Array.from({ length: 6 }, (_, i) => (
                        <p key={i} style={{ margin: 0, color: COLOR.ink60, fontSize: TEXT.small }}>
                            Длинное содержимое прокручивается внутри шторки, а кнопка «Пополнить» остаётся внизу. Строка {i + 1}.
                        </p>
                    ))}
                </div>
            </Sheet>
        </div>
    );
}

function Tokens() {
    const swatches: [string, string][] = [
        ['paper', COLOR.paper], ['card', COLOR.card], ['sunken', COLOR.sunken], ['ink', COLOR.ink],
        ['ink80', COLOR.ink80], ['ink60', COLOR.ink60], ['ink40', COLOR.ink40], ['ink30', COLOR.ink30],
        ['ink20', COLOR.ink20], ['ink10', COLOR.ink10], ['accent', COLOR.accent], ['accentInk', COLOR.accentInk],
        ['accentSoft', COLOR.accentSoft], ['unboxGrey', COLOR.unboxGrey], ['danger solid', STATUS.dangerSolid],
    ];
    return (
        <div>
            <H2>Цвет (контраст — на бумаге #FAFAF7)</H2>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: SPACE[2] }}>
                {swatches.map(([name, value]) => {
                    const c = contrastOn(value, COLOR.paper);
                    return (
                        <div key={name} style={{ border: `1px solid ${COLOR.ink10}`, background: COLOR.card }}>
                            <div style={{ height: 40, background: value, borderBottom: `1px solid ${COLOR.ink10}` }} />
                            <div style={{ padding: SPACE[2], fontSize: TEXT.caption, lineHeight: 1.4 }}>
                                <div style={{ fontWeight: 600 }}>{name}</div>
                                <div className="num" style={{ color: COLOR.ink60 }}>{value}</div>
                                <div className="num" style={{ color: c >= 4.5 ? STATUS.ok.fg : COLOR.ink60 }}>
                                    {c.toFixed(2)}:1 {c >= 4.5 ? '· текст' : '· линии'}
                                </div>
                            </div>
                        </div>
                    );
                })}
            </div>
            <Label>статусы</Label>
            <Row>
                {(['ok', 'pending', 'danger', 'info', 'muted'] as const).map(t => (
                    <span key={t} className={`ui-badge ui-badge--${t}`}>
                        {t} · {contrastOn(STATUS[t].fg, STATUS[t].bg).toFixed(1)}:1
                    </span>
                ))}
            </Row>

            <H2>Шрифт и шкала</H2>
            {(Object.entries(TEXT) as [keyof typeof TEXT, number][]).map(([name, px]) => (
                <div key={name} style={{ display: 'flex', alignItems: 'baseline', gap: SPACE[3], borderTop: `1px solid ${COLOR.ink10}`, padding: `${SPACE[2]}px 0`, overflow: 'hidden' }}>
                    <span className="num" style={{ width: 88, flex: 'none', fontSize: TEXT.caption, color: COLOR.ink60 }}>{name} {px}</span>
                    <span style={{ fontSize: px, lineHeight: px >= 20 ? 1.2 : 1.5, fontWeight: px >= 20 ? 600 : 400, whiteSpace: 'nowrap' }}>
                        Спокойный, точный
                    </span>
                </div>
            ))}
            <div style={{ borderTop: `1px solid ${COLOR.ink10}`, padding: `${SPACE[2]}px 0`, fontSize: TEXT.body }}>
                <span style={{ fontWeight: 400 }}>400 обычный</span> · <span style={{ fontWeight: 500 }}>500 средний</span> · <span style={{ fontWeight: 600 }}>600 полужирный</span> · <span className="num">1 250 ₾ · 14:05</span>
            </div>

            <H2>Скругления · тень · отступы</H2>
            <Row>
                {(Object.entries(RADIUS) as [string, number][]).map(([name, r]) => (
                    <div key={name} style={{ width: 96, height: 64, borderRadius: r, border: `1px solid ${COLOR.ink20}`, background: COLOR.card, display: 'grid', placeItems: 'center', fontSize: TEXT.caption }}>
                        {name} {r}
                    </div>
                ))}
                <div style={{ width: 96, height: 64, borderRadius: RADIUS.sheet, background: COLOR.card, boxShadow: SHADOW.pop, display: 'grid', placeItems: 'center', fontSize: TEXT.caption }}>
                    shadow pop
                </div>
            </Row>
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: SPACE[2], marginTop: SPACE[3] }}>
                {Object.values(SPACE).map(s => (
                    <div key={s} style={{ textAlign: 'center', fontSize: TEXT.caption, color: COLOR.ink60 }}>
                        <div style={{ width: s, height: s, background: COLOR.accent, margin: '0 auto 4px' }} />
                        {s}
                    </div>
                ))}
            </div>
        </div>
    );
}

export function DevUiPage() {
    return (
        <div style={{ minHeight: '100vh', background: COLOR.paper, color: COLOR.ink, fontFamily: 'var(--font-sans)' }}>
            <div style={{ maxWidth: 1360, margin: '0 auto', padding: `${SPACE[5]}px ${SPACE[4]}px ${SPACE[7]}px` }}>
                <PageHeader
                    title="Дизайн-система Unbox"
                    description="Витрина wave 1: токены и общие компоненты. Только для разработки — в прод не попадает."
                    actions={<Button variant="secondary" icon={<Bell size={16} aria-hidden="true" />}>Действие</Button>}
                />
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: SPACE[6], alignItems: 'flex-start' }}>
                    <section
                        data-density="touch"
                        aria-label="Телефон"
                        style={{ width: '100%', maxWidth: 390, flex: 'none', background: COLOR.card, border: `1px solid ${COLOR.ink10}`, borderRadius: RADIUS.sheet, overflow: 'hidden' }}
                    >
                        <MobilePageHeader title="Телефон · 44 px" className="static" action={
                            <Button variant="quiet" size="touch" icon={<Wallet size={20} aria-hidden="true" />} aria-label="Касса" />
                        } />
                        <div style={{ padding: `0 ${SPACE[4]}px ${SPACE[5]}px` }}>
                            <Components id="touch" />
                        </div>
                    </section>
                    <section data-density="compact" aria-label="Компьютер" style={{ flex: '1 1 480px', minWidth: 0 }}>
                        <div style={{ fontSize: TEXT.caption, color: COLOR.ink60, marginBottom: SPACE[2] }}>Компьютер · 36 px</div>
                        <Tokens />
                        <Components id="compact" />
                    </section>
                </div>
            </div>
        </div>
    );
}
