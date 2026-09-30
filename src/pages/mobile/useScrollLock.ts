// Лок прокрутки переехал в src/hooks/useScrollLock.ts (wave 1): им теперь
// пользуется и общий Sheet из src/components/ui. Старый путь оставлен, чтобы
// не трогать импорты мобильных экранов.
export { useScrollLock, forceUnlockScroll } from '../../hooks/useScrollLock';
