import { useEffect, useRef, useState } from 'react';
import { Loader2, Repeat } from 'lucide-react';
import { COLOR, RADIUS, STATUS, TEXT, Z } from '../../design/tokens';
import { LOCATIONS } from '../../utils/data';
import type { BookingHistoryItem } from '../../store/types';
import { GRID_END_MIN, GRID_STEP_MIN, type GridBlock, type GridColumn } from './dayGridModel';

/* Сетка дня: кабинеты колонками, время слева (шаг 2 плана мобильной брони).
 * Только рисует и сообщает о касаниях; что можно выбрать, решает экран. */

/** Высота получаса. 40 px — день 9:00–22:00 укладывается в ~1,3 экрана, а
 *  ячейка шириной с колонку (≈90 px) остаётся удобной целью для пальца:
 *  промах на соседний получас (12:30 вместо 12:00) — самая частая ошибка сетки. */
export const SLOT_PX = 40;
const RAIL_PX = 42;
const COL_GAP = 6;
const SIDE_PX = 12;
/** Больше трёх колонок (дни, когда открыто несколько центров) на узкий экран не
 *  помещаются — сетка листается вбок, у колонки остаётся ширина под палец;
 *  шкала времени при этом прилипает к левому краю. */
const MAX_FIT_COLS = 3;
const MIN_COL_PX = 88;

export interface GridSelection {
    roomId: string;
    startMin: number;
    duration: number;
}

interface Props {
    columns: GridColumn[];
    /** С какой минуты рисуем день (кратно часу): сегодня — с текущего часа. */
    firstRowMin: number;
    /** Почему ячейку нельзя выбрать («прошло», «через админа»); null — можно.
     *  Закрытая ячейка — не кнопка; причина подписана в начале закрытого отрезка. */
    closedReason: (startMin: number) => string | null;
    /** Пиковый получас (надбавка) — помечаем на шкале времени. */
    isPeak: (startMin: number) => boolean;
    /** Подпись надбавки на шкале: «+5 ₾». */
    peakTag: string;
    selection: GridSelection | null;
    /** Запрос по выбранному времени уже идёт — на выделении крутится спиннер. */
    selectionPending?: boolean;
    /** Перенос: где бронь стоит сейчас (в этот день). */
    oldPlace?: { roomId: string; startMin: number; endMin: number } | null;
    /** Кабинет, с которым пришли (ссылка со страницы кабинета). */
    highlightRoomId?: string | null;
    /** Открыто больше одного центра — под именем кабинета пишем центр. */
    showCenter: boolean;
    disabled?: boolean;
    onPickFree: (roomId: string, startMin: number) => void;
    /** Касание занятого времени («сообщить, когда освободится»); нет — блок не нажимается. */
    onPickBusy?: (roomId: string, startMin: number) => void;
    onPickMine: (booking: BookingHistoryItem) => void;
    onClearSelection: () => void;
}

const hm = (m: number) => `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`;

function centerShort(locationId?: string): string {
    const name = LOCATIONS.find(l => l.id === locationId)?.name ?? '';
    return name.replace(/^Unbox\s*/i, '');
}

export function DayGrid({
    columns, firstRowMin, closedReason, isPeak, peakTag, selection, selectionPending, oldPlace,
    highlightRoomId, showCenter, disabled, onPickFree, onPickBusy, onPickMine, onClearSelection,
}: Props) {
    const scrollX = columns.length > MAX_FIT_COLS;
    const rows = Math.max(0, (GRID_END_MIN - firstRowMin) / GRID_STEP_MIN);
    const height = rows * SLOT_PX;
    const y = (min: number) => ((min - firstRowMin) / GRID_STEP_MIN) * SLOT_PX;

    const template: React.CSSProperties = {
        display: 'grid',
        gridTemplateColumns: `${RAIL_PX}px repeat(${columns.length}, minmax(${scrollX ? `${MIN_COL_PX}px` : '0'}, 1fr))`,
        columnGap: COL_GAP,
    };

    /* Имена кабинетов остаются на виду, пока листаешь день вниз. Обычный
     * position: sticky здесь не работает: оболочка /m растёт по содержимому,
     * листается страница целиком, а ближайший «прокручиваемый» предок (main)
     * сам не листается. Поэтому — закреплённая копия строки имён, которая
     * появляется, когда настоящая ушла за верх экрана. */
    const headRef = useRef<HTMLDivElement>(null);
    const bodyRef = useRef<HTMLDivElement>(null);
    const [floating, setFloating] = useState(false);
    useEffect(() => {
        if (scrollX) return;
        let raf = 0;
        const check = () => {
            raf = 0;
            const head = headRef.current, body = bodyRef.current;
            if (!head || !body) return;
            setFloating(head.getBoundingClientRect().bottom < 0 && body.getBoundingClientRect().bottom > 96);
        };
        const onScroll = () => { if (!raf) raf = requestAnimationFrame(check); };
        // capture: ловим прокрутку и страницы, и любого внутреннего контейнера.
        window.addEventListener('scroll', onScroll, { passive: true, capture: true });
        window.addEventListener('resize', onScroll);
        onScroll();
        return () => {
            window.removeEventListener('scroll', onScroll, { capture: true });
            window.removeEventListener('resize', onScroll);
            if (raf) cancelAnimationFrame(raf);
        };
    }, [scrollX, columns.length]);

    // Выделение не должно прятаться под полосой «Дальше» внизу экрана.
    const selRef = useRef<HTMLButtonElement>(null);
    useEffect(() => {
        if (!selection) return;
        const el = selRef.current;
        if (!el) return;
        const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
        el.scrollIntoView({ block: 'nearest', behavior: reduce ? 'auto' : 'smooth' });
    }, [selection]);

    const head = (col: GridColumn, compact: boolean) => {
        const marked = col.room.id === highlightRoomId;
        return (
            <div key={col.room.id} style={{ minWidth: 0, padding: compact ? '0 6px' : '0 6px 6px', lineHeight: 1.25 }}>
                <div style={{
                    fontSize: TEXT.small, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                    color: marked ? COLOR.accentInk : COLOR.ink,
                }}>
                    {col.room.name}
                </div>
                {!compact && (
                    <div style={{ fontSize: TEXT.caption, color: COLOR.ink60, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {showCenter ? centerShort(col.room.locationId) : `до ${col.room.capacity ?? 4} чел.`}
                    </div>
                )}
            </div>
        );
    };

    const hours: number[] = [];
    for (let t = firstRowMin; t < GRID_END_MIN; t += 60) hours.push(t);
    // Когда сетка листается вбок, время остаётся слева на виду.
    const stickyRail: React.CSSProperties = scrollX
        ? { position: 'sticky', left: 0, zIndex: 3, background: COLOR.paper }
        : {};

    const grid = (
        <div style={{ minWidth: scrollX ? RAIL_PX + columns.length * (MIN_COL_PX + COL_GAP) : undefined }}>
            <div ref={headRef} style={template}>
                <span style={stickyRail} />
                {columns.map(col => head(col, false))}
            </div>
            <div ref={bodyRef} style={template}>
                {/* Шкала времени */}
                <div aria-hidden="true" style={{ position: 'relative', height, ...stickyRail }}>
                    {hours.map(t => (
                        <div key={t} className="num" style={{
                            position: 'absolute', top: y(t), left: 0, right: 4, height: SLOT_PX * 2,
                            textAlign: 'right', lineHeight: 1.2, fontSize: TEXT.caption, whiteSpace: 'nowrap',
                        }}>
                            <div style={{ fontWeight: 600, color: COLOR.ink80, paddingTop: 3 }}>{hm(t)}</div>
                            {(isPeak(t) || isPeak(t + GRID_STEP_MIN)) && (
                                <div style={{ fontWeight: 600, color: STATUS.pending.fg }}>{peakTag}</div>
                            )}
                            {/* Половина часа подписана: начало в :30 не должно получаться случайно. */}
                            <div style={{ position: 'absolute', top: SLOT_PX + 3, right: 0, color: COLOR.ink60 }}>:30</div>
                        </div>
                    ))}
                </div>

                {columns.map(col => {
                    const cells: number[] = [];
                    for (let t = firstRowMin; t < GRID_END_MIN; t += GRID_STEP_MIN) cells.push(t);
                    const sel = selection && selection.roomId === col.room.id ? selection : null;
                    const old = oldPlace && oldPlace.roomId === col.room.id ? oldPlace : null;
                    return (
                        <div
                            key={col.room.id}
                            role="group"
                            aria-label={col.room.name}
                            style={{
                                position: 'relative', height, minWidth: 0,
                                background: COLOR.card, borderRadius: RADIUS.control, overflow: 'hidden',
                            }}
                        >
                            {cells.map(t => {
                                const line = t === firstRowMin ? 'none'
                                    : `1px solid ${t % 60 === 0 ? COLOR.ink10 : COLOR.ink05}`;
                                const base: React.CSSProperties = {
                                    position: 'absolute', top: y(t), left: 0, right: 0, height: SLOT_PX,
                                    borderTop: line, boxSizing: 'border-box',
                                };
                                // Под плашкой «занято» линии часов не рисуем — просвечивали бы сквозь неё.
                                if (col.busy.has(t)) return null;
                                const closed = closedReason(t);
                                if (closed) {
                                    // Закрытое время — «вырез» в дорожке цветом страницы, без линий.
                                    // Причина подписана один раз, в начале закрытого отрезка.
                                    const prev = t - GRID_STEP_MIN;
                                    const first = t === firstRowMin || col.busy.has(prev) || closedReason(prev) !== closed;
                                    return (
                                        <div key={t} style={{
                                            ...base, borderTop: 'none', background: COLOR.paper,
                                            color: COLOR.ink60, fontSize: TEXT.caption, padding: '4px 8px', lineHeight: 1.25,
                                        }}>
                                            {first ? closed : null}
                                        </div>
                                    );
                                }
                                return (
                                    <button
                                        key={t}
                                        type="button"
                                        className="m-grid-cell"
                                        disabled={disabled}
                                        aria-label={`${col.room.name}, ${hm(t)} — свободно`}
                                        onClick={() => onPickFree(col.room.id, t)}
                                        style={{
                                            ...base, borderLeft: 'none', borderRight: 'none', borderBottom: 'none',
                                            padding: 0, fontFamily: 'inherit', cursor: disabled ? 'default' : 'pointer',
                                        }}
                                    />
                                );
                            })}

                            {col.blocks.map(b => (
                                <Block
                                    key={b.key}
                                    block={b}
                                    roomName={col.room.name}
                                    firstRowMin={firstRowMin}
                                    y={y}
                                    onPickBusy={onPickBusy ? (t) => onPickBusy(col.room.id, t) : undefined}
                                    onPickMine={onPickMine}
                                    disabled={disabled}
                                />
                            ))}

                            {old && old.endMin > firstRowMin && (
                                <div aria-hidden="true" style={{
                                    position: 'absolute', left: 2, right: 2,
                                    top: y(Math.max(old.startMin, firstRowMin)) + 1,
                                    height: y(old.endMin) - y(Math.max(old.startMin, firstRowMin)) - 2,
                                    border: `1.5px dashed ${COLOR.accent}`, borderRadius: RADIUS.control,
                                    color: COLOR.accentInk, fontSize: TEXT.caption, fontWeight: 600,
                                    padding: '3px 6px', pointerEvents: 'none', boxSizing: 'border-box',
                                }}>
                                    ваша бронь<br />сейчас
                                </div>
                            )}

                            {sel && (
                                <button
                                    ref={selRef}
                                    type="button"
                                    className="num"
                                    onClick={onClearSelection}
                                    aria-label={`Выбрано: ${col.room.name}, ${hm(sel.startMin)}–${hm(sel.startMin + sel.duration)}. Нажмите, чтобы снять выбор`}
                                    style={{
                                        position: 'absolute', left: 2, right: 2,
                                        top: y(sel.startMin) + 1, height: (sel.duration / GRID_STEP_MIN) * SLOT_PX - 2,
                                        // Запас под закреплённую полосу «Дальше» и под строку имён кабинетов.
                                        scrollMarginBottom: 264, scrollMarginTop: 56, outlineOffset: -2,
                                        background: COLOR.accentFill, color: COLOR.onAccentFill,
                                        border: 'none', borderRadius: RADIUS.control,
                                        padding: '4px 6px', fontFamily: 'inherit', fontSize: TEXT.caption, fontWeight: 600,
                                        textAlign: 'left', display: 'flex', alignItems: 'flex-start', gap: 4,
                                        cursor: 'pointer', zIndex: 2, boxSizing: 'border-box', lineHeight: 1.25,
                                    }}
                                >
                                    <span style={{ flex: 1, minWidth: 0 }}>
                                        {hm(sel.startMin)}–{hm(sel.startMin + sel.duration)}
                                    </span>
                                    {selectionPending && <Loader2 size={12} className="animate-spin" aria-hidden="true" />}
                                </button>
                            )}
                        </div>
                    );
                })}
            </div>
        </div>
    );

    return (
        <>
            <div style={{ padding: `0 ${SIDE_PX}px`, overflowX: scrollX ? 'auto' : undefined }}>
                {grid}
            </div>
            {floating && !scrollX && (
                <div aria-hidden="true" style={{
                    position: 'fixed', top: 0, left: '50%', transform: 'translateX(-50%)',
                    width: '100%', maxWidth: 480, zIndex: Z.sticky,
                    background: COLOR.paper, borderBottom: `1px solid ${COLOR.ink10}`,
                    paddingTop: 'env(safe-area-inset-top, 0px)',
                }}>
                    <div style={{ ...template, padding: `8px ${SIDE_PX}px` }}>
                        <span />
                        {columns.map(col => head(col, true))}
                    </div>
                </div>
            )}
        </>
    );
}

function Block({ block, roomName, firstRowMin, y, onPickBusy, onPickMine, disabled }: {
    block: GridBlock;
    roomName: string;
    firstRowMin: number;
    y: (min: number) => number;
    onPickBusy?: (startMin: number) => void;
    onPickMine: (booking: BookingHistoryItem) => void;
    disabled?: boolean;
}) {
    if (block.endMin <= firstRowMin) return null;
    const from = Math.max(block.startMin, firstRowMin);
    const top = y(from) + 1;
    const height = y(block.endMin) - y(from) - 2;
    const range = `${hm(block.startMin)}–${hm(block.endMin)}`;
    const box: React.CSSProperties = {
        position: 'absolute', left: 2, right: 2, top, height,
        borderRadius: RADIUS.control, padding: '3px 6px', boxSizing: 'border-box',
        fontFamily: 'inherit', fontSize: TEXT.caption, lineHeight: 1.25, textAlign: 'left',
        overflow: 'hidden', display: 'flex', flexDirection: 'column', alignItems: 'flex-start', justifyContent: 'flex-start',
        zIndex: 1,
    };

    if (block.kind === 'rerent') {
        // Пересдача: время свободно для брони — касание проходит к ячейкам под плашкой.
        return (
            <div aria-hidden="true" style={{
                ...box, pointerEvents: 'none',
                background: STATUS.pending.bg, color: STATUS.pending.fg,
                border: `1px dashed ${STATUS.pending.fg}`, fontWeight: 600,
            }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                    <Repeat size={12} aria-hidden="true" /> пересдача
                </span>
                {height >= SLOT_PX * 2 - 2 && <span style={{ fontWeight: 500 }}>можно занять</span>}
            </div>
        );
    }

    if (block.kind === 'mine') {
        return (
            <button
                type="button"
                className="press"
                onClick={() => onPickMine(block.booking)}
                aria-label={`Ваша бронь: ${roomName}, ${range}. Открыть`}
                style={{
                    ...box, cursor: 'pointer',
                    background: COLOR.accentSoft, color: COLOR.accentInk,
                    border: `1px solid ${COLOR.accent}`, fontWeight: 600,
                }}
            >
                <span>ваша</span>
                {height >= SLOT_PX * 2 - 2 && (
                    <span className="num" style={{ fontWeight: 500 }}>{block.listed ? 'на пересдаче' : range}</span>
                )}
            </button>
        );
    }

    const busyLook: React.CSSProperties = {
        ...box,
        color: COLOR.ink80,
        // Ровная тёмная плашка с подписью: «занято» читается и по тону (заметно
        // темнее свободной дорожки, в том числе на солнце), и по слову. Штриховку-
        // градиент не берём — на телефоне только ровные заливки.
        background: COLOR.ink10,
        border: `1px solid ${COLOR.ink20}`,
    };
    if (!onPickBusy) {
        return <div role="img" aria-label={`${roomName}, занято ${range}`} style={busyLook}>занято</div>;
    }
    return (
        <button
            type="button"
            disabled={disabled}
            aria-label={`${roomName}, занято ${range}. Сообщить, когда освободится`}
            onClick={(e) => {
                // Какой получас внутри длинной брони нажали (с клавиатуры — её начало).
                const rect = e.currentTarget.getBoundingClientRect();
                const dy = e.clientY ? Math.max(0, e.clientY - rect.top) : 0;
                const gridFrom = Math.floor(from / GRID_STEP_MIN) * GRID_STEP_MIN;
                const t = gridFrom + Math.floor(dy / SLOT_PX) * GRID_STEP_MIN;
                onPickBusy(Math.max(gridFrom, Math.min(t, block.endMin - GRID_STEP_MIN)));
            }}
            style={{ ...busyLook, cursor: disabled ? 'default' : 'pointer' }}
        >
            занято
        </button>
    );
}
