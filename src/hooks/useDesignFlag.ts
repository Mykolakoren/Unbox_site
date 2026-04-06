/**
 * Grid House design flag.
 *
 * - `?design=grid` in URL turns it on and persists via localStorage.
 * - `?design=off`  in URL turns it off and clears the flag.
 * - Otherwise, the previous localStorage state is read.
 *
 * Returns `true` when the Grid House variant should render.
 *
 * Full rollback: delete this file + every `if (useDesignFlag())` branch that
 * references it. The Grid House variants are isolated from the default code
 * paths and do not mutate shared state.
 */
export function useDesignFlag(): boolean {
    if (typeof window === 'undefined') return false;

    const urlValue = new URLSearchParams(window.location.search).get('design');
    if (urlValue === 'grid') {
        localStorage.setItem('unbox_design_flag', 'grid');
        return true;
    }
    if (urlValue === 'off') {
        localStorage.removeItem('unbox_design_flag');
        return false;
    }
    return localStorage.getItem('unbox_design_flag') === 'grid';
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
