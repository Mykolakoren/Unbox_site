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
export const GH = {
    ink: '#0F0F10',
    paper: '#FAFAF7',
    ink5: 'rgba(15,15,16,0.05)',
    ink8: 'rgba(15,15,16,0.08)',
    ink10: 'rgba(15,15,16,0.10)',
    ink30: 'rgba(15,15,16,0.30)',
    ink60: 'rgba(15,15,16,0.60)',
    cellDead: '#F6F2E8',
    accent: '#476D6B',
    danger: '#B84A2F',
    // Teal-ink for mono-uppercase labels. A shade deeper than `accent` so that
    // 10-11px letter-spaced text on paper hits ~5:1 contrast (WCAG AA for
    // small text). Swap to `ink60` to revert the "teal labels" experiment.
    label: '#2F5F5E',
} as const;

export const GH_SANS = '"IBM Plex Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
export const GH_MONO = '"IBM Plex Mono", ui-monospace, "SF Mono", Menlo, monospace';
