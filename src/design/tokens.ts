/**
 * Токены дизайн-системы Unbox (Grid House) — TS-зеркало.
 *
 * Единственный источник — `@theme` в src/index.css. Здесь те же значения
 * для inline-стилей (style={{ … }}), где CSS-переменная неудобна: строки
 * склеиваются с альфой (`${COLOR.accent}14`), уходят в SVG/графики и т.п.
 * Поэтому цвета здесь — буквальные hex/rgba, а не var(--…).
 *
 * Меняете значение — меняйте в ОБОИХ местах. Сторож
 * backend/tests/guard_wave1_foundation.py сверяет их и упадёт при расхождении.
 * Правила применения — docs/DESIGN-SYSTEM.md.
 */

/** Нейтральные: бумага и чернила. Текст — не бледнее ink60 (5:1 на бумаге).
 *  ink40/ink30/ink20/ink10 — только линии, иконки и неактивное, НЕ текст. */
export const COLOR = {
    paper: '#FAFAF7',   // фон страницы
    card: '#FDFDFB',    // карточки, шторки, поля (вместо чистого #FFF)
    sunken: '#F4F4F2',  // углублённое: чипы, дорожка сегментов, скелетон
    ink: '#0F0F10',     // основной текст
    ink80: 'rgba(15,15,16,0.80)',
    ink60: 'rgba(15,15,16,0.60)', // вторичный текст — минимум для любого текста
    ink40: 'rgba(15,15,16,0.40)',
    ink30: 'rgba(15,15,16,0.30)',
    ink20: 'rgba(15,15,16,0.20)',
    ink10: 'rgba(15,15,16,0.10)',
    ink08: 'rgba(15,15,16,0.08)',
    ink05: 'rgba(15,15,16,0.05)',
    onInk: '#FAFAF7',   // текст на тёмном
    overlay: 'rgba(15,15,16,0.45)', // затемнение фона под шторкой/окном
    sidebar: '#F0ECDD',       // боковая панель админки
    sidebarNarrow: '#F3EFE2', // она же в узком виде
    // Бирюза Unbox — только «выбрано», фокус и главная кнопка.
    accent: '#476D6B',
    accentHover: '#3B5B59',
    accentInk: '#2F5F5E',   // мелкий текст акцентом
    accentSoft: '#E7ECEA',  // подложка выбранного
    onAccent: '#FDFDFB',
    // Легаси-серый старых экранов (text-unbox-grey). Был #9299A3 — 2.75:1.
    unboxGrey: '#636A74',
} as const;

/** Статусы — единственные цвета со смыслом. fg на своём bg ≥ 4.5:1.
 *  ok — оплачено/подтверждено, pending — ждём, danger — долг/отмена/опасно,
 *  info — нейтрально-информационное (запланировано), muted — прошло,
 *  warn — «внимание» (не деньги: например, оранжевый результат теста). */
export const STATUS = {
    ok: { bg: '#E6F4EA', fg: '#1B6E36' },
    pending: { bg: '#FEF3C7', fg: '#8A5A00' },
    danger: { bg: '#FEE2E2', fg: '#991B1B' },
    info: { bg: '#DBEAFE', fg: '#1E40AF' },
    muted: { bg: '#EEEEEE', fg: '#555555' },
    warn: { bg: '#FFEDD5', fg: '#7C2D12' },
    dangerSolid: '#C8253A', // заливка опасной кнопки
} as const;

export type StatusTone = 'ok' | 'pending' | 'danger' | 'info' | 'muted' | 'warn';

export const FONT = {
    sans: '"IBM Plex Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    mono: '"IBM Plex Mono", ui-monospace, "SF Mono", Menlo, monospace',
} as const;

/** Шкала текста, px. Меньше 12 — нельзя. 14 — вторичный и плотные таблицы,
 *  16 — основной, 20 — заголовок карточки, 28 — заголовок экрана,
 *  40/56 — только публичные страницы. */
export const TEXT = {
    caption: 12,
    small: 14,
    body: 16,
    title: 20,
    heading: 28,
    display: 40,
    hero: 56,
} as const;

export const WEIGHT = { regular: 400, medium: 500, semibold: 600 } as const;
export const LEADING = { body: 1.5, heading: 1.2 } as const;

/** Отступы — шаг 4 px. Поля экрана на телефоне — SPACE[4] (16). */
export const SPACE = { 1: 4, 2: 8, 3: 12, 4: 16, 5: 24, 6: 32, 7: 48 } as const;

/** Три скругления: grid (0) — десктоп Grid House, control (8) — кнопки,
 *  поля, чипы, бейджи, sheet (16) — шторки и карточки на телефоне. */
export const RADIUS = { grid: 0, control: 8, sheet: 16 } as const;

/** Одна тень — только для всплывающего (шторки, меню, окна). */
export const SHADOW = {
    pop: '0 12px 32px -8px rgba(15,15,16,0.18), 0 2px 6px rgba(15,15,16,0.06)',
} as const;

/** Слои. Нижнее меню — nav; любая шторка обязана быть выше него.
 *  dialog — подтверждения: выше всех старых модалок (1000/9999/10000),
 *  пока их не перевели на общий Sheet. */
export const Z = {
    dropdown: 40,
    sticky: 90,
    nav: 100,
    sheetBackdrop: 200,
    sheet: 201,
    tour: 300,   // экскурсия /m: фон tour, подсветка tour+1, карточка tour+2
    dialog: 10050,
    toast: 10100,
    tooltip: 10200,
} as const;

/** Движение: нажатие 140 мс (scale 0.97), UI 200 мс, шторка 220/180 мс. */
export const MOTION = {
    press: 140,
    ui: 200,
    sheetIn: 220,
    sheetOut: 180,
    easeOut: [0.23, 1, 0.32, 1] as [number, number, number, number],
    easeDrawer: [0.32, 0.72, 0, 1] as [number, number, number, number],
} as const;
