import type { CSSProperties } from 'react';

/**
 * Слои мобильной админки.
 *
 * Нижнее меню (MobileAdminLayout) — 100. Любая шторка обязана быть выше:
 * при равном или меньшем слое меню, которое стоит в DOM позже, рисуется
 * поверх и закрывает главную кнопку шторки. Так было с «Пополнить баланс»,
 * «Новая операция» и «Закрыть кабинет» — промах по кнопке уводил на другую
 * вкладку, и введённое пропадало. Шторка поверх шторки — Z_SHEET_OVER_SHEET.
 */
export const Z_TABBAR = 100;
export const Z_SHEET = 200;
export const Z_SHEET_OVER_SHEET = 210;

/** Низ шторки с главной кнопкой. Прилипает к низу, когда форма длиннее
 *  экрана (кнопку не надо искать прокруткой), и сам несёт отступ под
 *  «домашнюю полоску» iPhone — поэтому у самой шторки нижний отступ 0. */
export const SHEET_FOOTER: CSSProperties = {
    position: 'sticky',
    bottom: 0,
    background: '#fff',
    paddingTop: 10,
    paddingBottom: 'calc(16px + env(safe-area-inset-bottom, 0px))',
};

/** Высота шторки: dvh учитывает адресную строку и тулбар Safari (vh — нет,
 *  и низ шторки уезжал под тулбар). Остальное прокручивается внутри. */
export const SHEET_MAX_HEIGHT = 'calc(100dvh - 16px)';
