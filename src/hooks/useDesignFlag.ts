/**
 * Grid House design tokens — single source of truth. Imported across the
 * codebase; do not rename without a full grep first.
 *
 * Historical note: this file used to also export a `useDesignFlag()` hook
 * that gated the classic vs Grid House designs. Dual-UI was fully unwound
 * in April 2026 — no more callsites, so the hook is gone. The filename
 * stays for now to avoid a 40-file import rename; plan is to move the
 * tokens into a `gh-tokens.ts` module and delete this one in a follow-up.
 */
import { COLOR, FONT, STATUS } from '../design/tokens';

// Wave 1 (30.09): GH больше не хранит свои значения — берёт их из общих
// токенов (src/design/tokens.ts ↔ @theme в index.css). Имена ключей прежние,
// чтобы ~60 файлов Grid House подхватили новую палитру без правок.
// ink30 — только линии и неактивное; для текста минимум ink60.
export const GH = {
    ink: COLOR.ink,
    paper: COLOR.paper,
    card: COLOR.card,
    sunken: COLOR.sunken,
    ink5: COLOR.ink05,
    ink8: COLOR.ink08,
    ink10: COLOR.ink10,
    ink20: COLOR.ink20,
    ink30: COLOR.ink30,
    ink60: COLOR.ink60,
    ink80: COLOR.ink80,
    cellDead: '#F6F2E8',
    accent: COLOR.accent,
    // Был свой кирпичный #B84A2F — одиннадцатый оттенок красного. Теперь это
    // статус «опасно» (--status-danger-fg), как во всём продукте.
    danger: STATUS.danger.fg,
    // Бирюза для мелких моно-подписей: на бумаге ~6.9:1 (AA для мелкого текста).
    label: COLOR.accentInk,
} as const;

export const GH_SANS = FONT.sans;
export const GH_MONO = FONT.mono;
