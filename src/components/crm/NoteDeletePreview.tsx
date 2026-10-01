import { ruCountWord } from '../../utils/plural';

/**
 * Текст для окна «Удалить заметку?»: начало самой заметки + предупреждение.
 * Заметка стирается из базы насовсем, поэтому психолог должен видеть, что
 * именно удаляет (аудит 29.09, G5-01). Общий для /crm/notes и карточки клиента.
 *
 * hideText — включено «Скрывать текст» (волна 3, G5-24): окно не должно
 * показывать терапевтический текст, который на экране скрыт. Тогда вместо
 * цитаты — только длина заметки.
 */
export function NoteDeletePreview({ content, hideText = false }: { content?: string; hideText?: boolean }) {
    const text = (content || '').trim();
    return (
        <>
            {text && !hideText && (
                <span style={{ display: 'block', fontStyle: 'italic', marginBottom: 6, wordBreak: 'break-word' }}>
                    «{text.length > 120 ? `${text.slice(0, 120).trimEnd()}…` : text}»
                </span>
            )}
            {text && hideText && (
                <span style={{ display: 'block', marginBottom: 6 }}>
                    Текст скрыт, в заметке {ruCountWord(text.length, ['знак', 'знака', 'знаков'])}.
                </span>
            )}
            Восстановить её будет нельзя.
        </>
    );
}
