import { useRef, useState } from 'react';
import { COLOR, FONT } from '../../design/tokens';
import { photoVariant } from '../../utils/cabinetPhotos';

/**
 * Лента фото с прокруткой пальцем (scroll-snap) — для телефона
 * (волна 2, пакет B; G2-14, G2-15).
 *
 * Кадр ≈ 85 % ширины, следующий выглядывает справа — видно, что можно листать.
 * В углу счётчик «3 / 12». Тап по кадру открывает PhotoLightbox (onOpen).
 * Грузим md-копии (800 px WebP) и только видимые — loading="lazy".
 */
export function PhotoStrip({ photos, onOpen, altFor, aspect = '4 / 3', inset = 16 }: {
    photos: string[];
    onOpen: (index: number) => void;
    altFor: (index: number) => string;
    aspect?: string;
    /** Боковое поле страницы: лента начинается от края текста, но прокручивается до края экрана. */
    inset?: number;
}) {
    const ref = useRef<HTMLDivElement>(null);
    const [current, setCurrent] = useState(0);
    if (photos.length === 0) return null;

    const onScroll = () => {
        const el = ref.current;
        if (!el) return;
        const first = el.firstElementChild as HTMLElement | null;
        const step = first ? first.offsetWidth + 8 : el.clientWidth;
        const i = Math.round(el.scrollLeft / Math.max(step, 1));
        setCurrent(Math.min(Math.max(i, 0), photos.length - 1));
    };

    return (
        <div style={{ position: 'relative' }}>
            <div
                ref={ref}
                onScroll={onScroll}
                role="list"
                aria-label="Фотографии"
                style={{
                    display: 'flex', gap: 8,
                    overflowX: 'auto',
                    scrollSnapType: 'x mandatory',
                    scrollPaddingLeft: inset,
                    padding: `0 ${inset}px`,
                    margin: `0 -${inset}px`,
                    scrollbarWidth: 'none',
                    WebkitOverflowScrolling: 'touch',
                }}
            >
                {photos.map((src, i) => (
                    <button
                        key={`${src}-${i}`}
                        type="button"
                        role="listitem"
                        onClick={() => onOpen(i)}
                        aria-label={`${altFor(i)} — открыть`}
                        style={{
                            flex: photos.length === 1 ? '0 0 100%' : '0 0 85%',
                            scrollSnapAlign: 'start',
                            padding: 0, border: 'none', margin: 0,
                            background: COLOR.sunken,
                            cursor: 'zoom-in',
                            display: 'block',
                        }}
                    >
                        <img
                            src={photoVariant(src, 'md')}
                            alt={altFor(i)}
                            loading={i < 2 ? 'eager' : 'lazy'}
                            decoding="async"
                            style={{ width: '100%', aspectRatio: aspect, objectFit: 'cover', display: 'block' }}
                        />
                    </button>
                ))}
            </div>
            {photos.length > 1 && (
                <div
                    aria-hidden="true"
                    style={{
                        position: 'absolute', top: 8, left: 8,
                        background: 'rgba(14,14,14,0.72)', color: COLOR.onInk,
                        fontFamily: FONT.mono, fontSize: 12,
                        padding: '4px 8px', borderRadius: 8,
                        pointerEvents: 'none',
                    }}
                >
                    {current + 1} / {photos.length}
                </div>
            )}
        </div>
    );
}
