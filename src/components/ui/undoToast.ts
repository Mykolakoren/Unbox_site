import { toast } from 'sonner';

/**
 * Уведомление с кнопкой «Вернуть» после удаления/отмены (wave 1, 30.09).
 *
 * Вместо «Вы уверены?» перед каждым мелким удалением — сделать сразу и дать
 * 5 секунд передумать. Для необратимого (деньги ушли клиенту, письмо
 * отправлено) по-прежнему спрашиваем confirm({ tone: 'danger' }) заранее.
 *
 *   await api.deleteNote(id);
 *   undoToast('Заметка удалена', () => api.restoreNote(id));
 *
 * Возвращает id уведомления (можно закрыть раньше: toast.dismiss(id)).
 */
export function undoToast(message: string, onUndo: () => void | Promise<unknown>, ms = 5000) {
    return toast(message, {
        duration: ms,
        action: {
            label: 'Вернуть',
            onClick: () => { void onUndo(); },
        },
    });
}
