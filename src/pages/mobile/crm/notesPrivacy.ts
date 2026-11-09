import { useCallback, useSyncExternalStore } from 'react';

/**
 * «Скрывать текст» заметок — одна настройка на всю мобильную CRM (09.11, ревью п. 10).
 *
 * Раньше переключатель действовал только во вкладке «Заметки» и был выключен
 * по умолчанию, а полный текст заметок показывали история клиента и шторка
 * сессии — ту самую, что открывают отметить оплату, пока клиент ещё в кабинете.
 *
 * Теперь: по умолчанию ВКЛЮЧЕНО (нет записи — скрываем). Выбор помним на этом
 * телефоне (localStorage — удобство, не данные; приватный режим — просто не
 * запомним). Все экраны читают одно значение и обновляются вместе.
 */
const HIDE_KEY = 'unbox.mcrm.notes.hideText';
const EVENT = 'unbox:mcrm-notes-hidden';

/** Запасное значение, если localStorage недоступен (приватный режим). */
let memo = true;

function read(): boolean {
    try { return localStorage.getItem(HIDE_KEY) !== '0'; } catch { return memo; }
}

function subscribe(cb: () => void): () => void {
    const onStorage = (e: StorageEvent) => { if (e.key === HIDE_KEY) cb(); };
    window.addEventListener(EVENT, cb);
    window.addEventListener('storage', onStorage);
    return () => {
        window.removeEventListener(EVENT, cb);
        window.removeEventListener('storage', onStorage);
    };
}

export function setNotesHidden(hidden: boolean): void {
    memo = hidden;
    try { localStorage.setItem(HIDE_KEY, hidden ? '1' : '0'); } catch { /* не запомним — не страшно */ }
    window.dispatchEvent(new Event(EVENT));
}

/** [скрыт ли текст заметок, переключить]. */
export function useNotesHidden(): [boolean, () => void] {
    const hidden = useSyncExternalStore(subscribe, read, () => true);
    const toggle = useCallback(() => setNotesHidden(!read()), []);
    return [hidden, toggle];
}
