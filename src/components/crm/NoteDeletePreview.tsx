/**
 * Текст для окна «Удалить заметку?»: начало самой заметки + предупреждение.
 * Заметка стирается из базы насовсем, поэтому психолог должен видеть, что
 * именно удаляет (аудит 29.09, G5-01). Общий для /crm/notes и карточки клиента.
 */
export function NoteDeletePreview({ content }: { content?: string }) {
    const text = (content || '').trim();
    return (
        <>
            {text && (
                <span style={{ display: 'block', fontStyle: 'italic', marginBottom: 6, wordBreak: 'break-word' }}>
                    «{text.length > 120 ? `${text.slice(0, 120).trimEnd()}…` : text}»
                </span>
            )}
            Восстановить её будет нельзя.
        </>
    );
}
