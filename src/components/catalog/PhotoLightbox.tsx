import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import { COLOR, FONT, Z } from '../../design/tokens';

/**
 * Просмотр фото на весь экран — один на страницы центра и кабинета
 * (волна 2, пакет B; G2-21).
 *
 * Раньше у LocationDetailsPage была своя модалка без клавиш, без свайпа, без
 * блокировки прокрутки и с полями 64 px (на телефоне фото сжималось до ~260 px).
 * Здесь: Esc закрывает, ← / → листают, свайп пальцем влево-вправо, фокус на
 * «Закрыть» и возврат фокуса после закрытия, фон не прокручивается, на узком
 * экране — без боковых полей. Кнопки 44×44.
 */
export interface PhotoLightboxProps {
    photos: string[];
    index: number;
    onClose: () => void;
    onIndexChange: (index: number) => void;
    /** Подпись для диктора: «Unbox Uni — фото 3 из 58». */
    altFor: (index: number) => string;
    /** Название окна для диктора. */
    label?: string;
}

export function PhotoLightbox({ photos, index, onClose, onIndexChange, altFor, label = 'Фотографии' }: PhotoLightboxProps) {
    const closeRef = useRef<HTMLButtonElement>(null);
    const touch = useRef<{ x: number; y: number; t: number } | null>(null);
    const count = photos.length;
    const go = (dir: 1 | -1) => {
        if (count < 2) return;
        onIndexChange((index + dir + count) % count);
    };
    // Свежие обработчики без переподписки на каждый кадр.
    const goRef = useRef(go);
    goRef.current = go;
    const closeFnRef = useRef(onClose);
    closeFnRef.current = onClose;

    useEffect(() => {
        const prevFocus = document.activeElement as HTMLElement | null;
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') { e.preventDefault(); closeFnRef.current(); }
            else if (e.key === 'ArrowRight') goRef.current(1);
            else if (e.key === 'ArrowLeft') goRef.current(-1);
        };
        document.addEventListener('keydown', onKey);
        const prevOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        closeRef.current?.focus();
        return () => {
            document.removeEventListener('keydown', onKey);
            document.body.style.overflow = prevOverflow;
            prevFocus?.focus?.();
        };
    }, []);

    // Соседние кадры подгружаем заранее — листание без мигания.
    useEffect(() => {
        if (count < 2) return;
        for (const i of [index + 1, index - 1]) {
            const img = new Image();
            img.src = photos[(i + count) % count];
        }
    }, [index, count, photos]);

    if (typeof document === 'undefined' || count === 0) return null;
    const safeIndex = Math.min(Math.max(index, 0), count - 1);

    return createPortal(
        <div
            role="dialog"
            aria-modal="true"
            aria-label={label}
            onClick={onClose}
            onTouchStart={e => {
                const t = e.touches[0];
                touch.current = { x: t.clientX, y: t.clientY, t: Date.now() };
            }}
            onTouchEnd={e => {
                const start = touch.current;
                touch.current = null;
                if (!start) return;
                const t = e.changedTouches[0];
                const dx = t.clientX - start.x;
                const dy = t.clientY - start.y;
                const fast = Date.now() - start.t < 400;
                // Горизонтальный жест: 50 px или быстрый короткий взмах.
                if (Math.abs(dx) > Math.abs(dy) && (Math.abs(dx) > 50 || (fast && Math.abs(dx) > 24))) {
                    go(dx < 0 ? 1 : -1);
                }
            }}
            className="gh-lightbox"
            style={{
                position: 'fixed', inset: 0,
                background: 'rgba(14,14,14,0.95)',
                zIndex: Z.dialog,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                touchAction: 'pan-y',
            }}
        >
            <img
                src={photos[safeIndex]}
                alt={altFor(safeIndex)}
                onClick={e => e.stopPropagation()}
                style={{ maxWidth: '100%', maxHeight: '86vh', objectFit: 'contain', userSelect: 'none' }}
                draggable={false}
            />
            <button
                ref={closeRef}
                type="button"
                onClick={e => { e.stopPropagation(); onClose(); }}
                aria-label="Закрыть"
                style={{ ...roundBtn, top: 'max(8px, env(safe-area-inset-top, 0px))', right: 8 }}
            >
                <X size={24} aria-hidden="true" />
            </button>
            {count > 1 && (
                <>
                    <button
                        type="button"
                        onClick={e => { e.stopPropagation(); go(-1); }}
                        aria-label="Предыдущее фото"
                        style={{ ...roundBtn, top: '50%', left: 8, transform: 'translateY(-50%)' }}
                    ><ChevronLeft size={26} aria-hidden="true" /></button>
                    <button
                        type="button"
                        onClick={e => { e.stopPropagation(); go(1); }}
                        aria-label="Следующее фото"
                        style={{ ...roundBtn, top: '50%', right: 8, transform: 'translateY(-50%)' }}
                    ><ChevronRight size={26} aria-hidden="true" /></button>
                </>
            )}
            <div
                aria-live="polite"
                style={{
                    position: 'absolute', left: 0, right: 0,
                    bottom: 'max(16px, env(safe-area-inset-bottom, 0px))',
                    textAlign: 'center', color: COLOR.onInk,
                    fontFamily: FONT.mono, fontSize: 14,
                    pointerEvents: 'none',
                }}
            >
                {safeIndex + 1} из {count}
            </div>
            <style>{`
                @media (min-width: 768px) {
                    .gh-lightbox { padding: 32px 72px; }
                }
            `}</style>
        </div>,
        document.body,
    );
}

const roundBtn: React.CSSProperties = {
    position: 'absolute',
    width: 44, height: 44,
    display: 'grid', placeItems: 'center',
    background: 'rgba(255,255,255,0.12)',
    border: 'none',
    borderRadius: 999,
    color: COLOR.onInk,
    cursor: 'pointer',
};
