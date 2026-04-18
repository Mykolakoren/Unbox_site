/**
 * Grid House is the only design.
 *
 * This hook stays here only so existing callsites keep compiling while we
 * unwind the dual-UI code. It always returns `true`, so every
 * `if (useDesignFlag())` branch passes and the legacy `else` paths
 * become dead code (to be removed file-by-file in a follow-up pass).
 *
 * The `?design=off` URL override is gone — there is no more "off" variant.
 */
export function useDesignFlag(): true {
    return true;
}

/**
 * Grid House design tokens — single source of truth. Imported across the
 * codebase; do not rename without a full grep first.
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
