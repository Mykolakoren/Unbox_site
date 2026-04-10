/**
 * Grid House design flag.
 *
 * Grid House is now the DEFAULT design.
 * - `?design=off`    in URL switches to legacy and persists via localStorage.
 * - `?design=grid`   in URL switches back to GH and clears the override.
 * - Otherwise, GH is used unless localStorage says 'off'.
 *
 * Returns `true` when the Grid House variant should render.
 */
export function useDesignFlag(): boolean {
    if (typeof window === 'undefined') return false;

    const urlValue = new URLSearchParams(window.location.search).get('design');
    if (urlValue === 'off') {
        localStorage.setItem('unbox_design_flag', 'off');
        return false;
    }
    if (urlValue === 'grid') {
        localStorage.removeItem('unbox_design_flag');
        return true;
    }
    // Default: GH on, unless explicitly opted out
    return localStorage.getItem('unbox_design_flag') !== 'off';
}

/**
 * Grid House design tokens — single source of truth.
 * Mirror of the tokens used in SpecialistBookingChessboardGrid + SpecialistProfilePage.
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
} as const;

export const GH_SANS = '"IBM Plex Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
export const GH_MONO = '"IBM Plex Mono", ui-monospace, "SF Mono", Menlo, monospace';
