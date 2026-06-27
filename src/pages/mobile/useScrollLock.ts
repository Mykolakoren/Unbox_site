import { useEffect } from 'react';

/**
 * Надёжная блокировка прокрутки фона на время открытого шита/модалки/тура.
 *
 * Owner 2026-06-26: раньше каждый оверлей лочил по-своему (кто class
 * scroll-locked, кто inline body.overflow с capture/restore). При
 * рассинхроне (race при навигации, два оверлея, тур на первом запуске)
 * блокировка ЗАЛИПАЛА → вся лента переставала скроллиться (скролл живёт
 * на body, см. MobileLayout: карточка minHeight:100vh).
 *
 * Решение — единый ref-counted лок:
 *  - класс body.scroll-locked вешается пока открыт хотя бы один оверлей;
 *  - снимается только когда закрылся последний (счётчик == 0);
 *  - forceUnlockScroll() — аварийный сброс (вызывается на смене роута в
 *    MobileLayout), гарантирует что фон не останется залоченным.
 */
let lockCount = 0;

function applyLock() {
    document.body.classList.add('scroll-locked');
}

export function useScrollLock() {
    useEffect(() => {
        lockCount += 1;
        applyLock();
        return () => {
            lockCount = Math.max(0, lockCount - 1);
            if (lockCount === 0) {
                document.body.classList.remove('scroll-locked');
            }
        };
    }, []);
}

/** Аварийный полный разлок — на смене экрана и т.п. */
export function forceUnlockScroll() {
    lockCount = 0;
    document.body.classList.remove('scroll-locked');
    // На случай если legacy-код оставил inline overflow.
    if (document.body.style.overflow === 'hidden') {
        document.body.style.overflow = '';
    }
}
