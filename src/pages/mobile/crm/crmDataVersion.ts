import { useOutletContext } from 'react-router-dom';

/** Что MobileCrmLayout передаёт экранам Psy-CRM через <Outlet context>. */
export interface MobileCrmOutletContext {
    /** Растёт, когда данные на сервере поменялись без участия экрана
     *  (прошедшие сессии автоматически закрылись → долги пересчитались). */
    crmDataVersion: number;
}

/** Номер «версии данных» Psy-CRM. Экран добавляет его в зависимости
 *  загрузки и сам перечитывает данные, когда номер меняется. Вне
 *  мобильной оболочки CRM — всегда 0. */
export function useCrmDataVersion(): number {
    const ctx = useOutletContext<MobileCrmOutletContext | null | undefined>();
    return ctx?.crmDataVersion ?? 0;
}
