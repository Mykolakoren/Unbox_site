import { useEffect } from 'react';

/**
 * Заголовок вкладки браузера (волна 2, шаг 0; X4-18).
 *
 * Раньше у всех страниц был один <title> — «Unbox — аренда кабинетов…»:
 * у админа пять вкладок с одинаковым названием, а экранный диктор не
 * объявляет, куда человек попал.
 *
 *   useDocumentTitle('Мои брони');          // «Мои брони · Unbox»
 *   useDocumentTitle('Касса · Админка');    // «Касса · Админка · Unbox»
 *   useDocumentTitle(client?.name);         // пока имени нет — заголовок не трогаем
 *
 * При уходе со страницы возвращает заголовок, который был до неё.
 */
export const DOCUMENT_TITLE_SUFFIX = 'Unbox';

export function documentTitle(title?: string | null): string {
    const t = (title ?? '').trim();
    return t ? `${t} · ${DOCUMENT_TITLE_SUFFIX}` : DOCUMENT_TITLE_SUFFIX;
}

export function useDocumentTitle(title?: string | null): void {
    const t = (title ?? '').trim();
    useEffect(() => {
        if (!t || typeof document === 'undefined') return;
        const previous = document.title;
        document.title = documentTitle(t);
        return () => {
            document.title = previous;
        };
    }, [t]);
}
