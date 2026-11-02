/**
 * Тема сайта (02.11, владелец): светлая / тёмная / как на устройстве.
 *
 * Выбор хранится в браузере. Нет выбора — светлая: кто не включал, ничего не
 * замечает. Атрибут data-theme ставит скрипт в index.html до первой отрисовки.
 * Смена темы перезагружает страницу: часть цветов читается один раз при загрузке
 * кода (src/design/tokens.ts), так все экраны гарантированно в одной теме.
 */
export type ThemeMode = 'light' | 'dark' | 'system';

const KEY = 'unbox.theme';

export function getThemeMode(): ThemeMode {
    try {
        const v = localStorage.getItem(KEY);
        return v === 'dark' || v === 'system' ? v : 'light';
    } catch {
        return 'light';
    }
}

export function setThemeMode(mode: ThemeMode): void {
    if (mode === getThemeMode()) return;
    try {
        if (mode === 'light') localStorage.removeItem(KEY);
        else localStorage.setItem(KEY, mode);
    } catch {
        return; // браузер не даёт сохранить — оставляем как есть
    }
    window.location.reload();
}
