import { useEffect } from 'react';

/**
 * «Пальцевая» плотность для мобильных оболочек /m.
 *
 * Высота кнопок, полей и чипов берётся из CSS-переменной --control-h
 * (index.css): 44 px на узком экране, 36 px на широком. Оболочка /m ставит
 * html[data-density="touch"], и тогда 44 px держится даже на компьютере —
 * включая шторки, которые рендерятся порталом прямо в body, вне оболочки.
 */
export function useTouchDensity() {
    useEffect(() => {
        const root = document.documentElement;
        const prev = root.getAttribute('data-density');
        root.setAttribute('data-density', 'touch');
        return () => {
            if (prev) root.setAttribute('data-density', prev);
            else root.removeAttribute('data-density');
        };
    }, []);
}
