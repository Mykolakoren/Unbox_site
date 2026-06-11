/**
 * Favourite cabinet — stored client-side in localStorage.
 *
 * Why local-only: this is a UX preference, not a server-of-truth fact. Stays
 * per-device, doesn't roam across browsers, but also avoids a backend
 * migration and an extra column on User. Good enough until specialists ask
 * for cross-device persistence.
 *
 * Key shape: per-user (keyed by user id) so two users on the same shared
 * device don't overwrite each other.
 */

const KEY_PREFIX = 'unbox.mobile.favCabinet:';

export function getFavoriteCabinet(userId: string | undefined): string | null {
    if (!userId || typeof window === 'undefined') return null;
    return localStorage.getItem(KEY_PREFIX + userId);
}

export function setFavoriteCabinet(userId: string | undefined, resourceId: string | null): void {
    if (!userId || typeof window === 'undefined') return;
    if (resourceId) localStorage.setItem(KEY_PREFIX + userId, resourceId);
    else localStorage.removeItem(KEY_PREFIX + userId);
}
