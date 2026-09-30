/**
 * Уменьшенные копии фото кабинетов (волна 2, пакет B; X5-17).
 *
 * Оригиналы /img/cabinets/<центр>/<папка>/NN.jpg — 1280×960, 150–190 КБ.
 * Раньше они грузились даже в миниатюры 36–72 px: /m/places тянул 1,1 МБ,
 * страница кабинета — 1,3 МБ. Скрипт scripts/make-cabinet-previews.py кладёт
 * рядом WebP-копии:
 *   sm/NN.webp — 360 px (миниатюры, строки списков)       ~8 КБ
 *   md/NN.webp — 800 px (лента фото, карточки, hero на телефоне) ~30 КБ
 *
 * Для любых других путей (старые /img/offices/…, фото из API) функция
 * возвращает исходный адрес — ничего не ломается.
 */
export type PhotoSize = 'sm' | 'md' | 'full';

const CABINET_PHOTO = /^(\/img\/cabinets\/[^/]+\/[^/]+)\/(\d{2})\.jpg$/;

export function photoVariant(src: string, size: PhotoSize): string {
    if (size === 'full' || !src) return src;
    const m = CABINET_PHOTO.exec(src);
    return m ? `${m[1]}/${size}/${m[2]}.webp` : src;
}

/** srcSet «md 800w, оригинал 1280w» — браузер сам выберет по ширине экрана. */
export function photoSrcSet(src: string): string | undefined {
    if (!CABINET_PHOTO.test(src)) return undefined;
    return `${photoVariant(src, 'md')} 800w, ${src} 1280w`;
}
